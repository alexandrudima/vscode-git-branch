
/// <reference path='git.d.ts'/>

import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import * as vscodeGit from 'vscode.git';
import * as qs from 'querystring';

let gitAPI: vscodeGit.API = null!;
export function activate(ctx: vscode.ExtensionContext) {
	gitAPI = vscode.extensions.getExtension('vscode.git')!.exports.getAPI(1);
	let treeDataProvider = new TreeDataProvider(ctx);
	vscode.window.registerTreeDataProvider('git-branch.view', treeDataProvider);
	vscode.commands.registerCommand('git-branch.refresh', function () {
		treeDataProvider.refresh();
	})
}

function getDiff(repository: vscodeGit.Repository, baseBranch: string): Promise<string> {
	return new Promise((c, e) => {
		cp.exec(
			`${gitAPI.git.path} diff ${baseBranch} HEAD --name-status`,
			{
				cwd: repository.rootUri.fsPath,
				maxBuffer: 10 * 1024 * 1024 // 10MB
			},
			function (err, diff, stderr) {
				if (err) {
					console.log(err);
					console.log(stderr);
					e(err);
					return;
				}

				c(diff);
			}
		);
	});
}

function getMergeBase(repository: vscodeGit.Repository): Promise<string> {
	const myConfig = vscode.workspace.getConfiguration('gitBranch');
	if (myConfig.mergeBase) {
		return Promise.resolve(myConfig.mergeBase);
	}

	const masterBranch = myConfig.base || 'master';

	// git merge-base HEAD master
	return new Promise((c, e) => {
		cp.exec(
			`${gitAPI.git.path} merge-base HEAD ${masterBranch}`,
			{
				cwd: repository.rootUri.fsPath,
				maxBuffer: 10 * 1024 * 1024 // 10MB
			},
			function (err, res, stderr) {
				if (err) {
					console.log(err);
					console.log(stderr);
					e(err);
					return;
				}

				c(res.trim());
			}
		);
	});
}

interface DiffGroupEntry {
	original: vscode.Uri;
	uri: vscode.Uri;
	relativePath: string;
	kind: 'added' | 'modified';
}

interface DiffGroup {
	name: string;
	test: (teststr: string) => boolean;
	entries: DiffGroupEntry[];
}

function isDiffGroup(element: DiffGroup | DiffGroupEntry): element is DiffGroup {
	return !!(<any>element).name;
}

interface IMyConfig {
	diffExcludes: string[];
	diffGroups: {
		name: string;
		files: string[];
	}[];
}

class TreeDataProvider implements vscode.TreeDataProvider<DiffGroup | DiffGroupEntry> {

	private readonly ctx: vscode.ExtensionContext;
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<undefined>();
	public readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private files!: Promise<DiffGroup[]>;

	constructor(ctx: vscode.ExtensionContext) {
		this.ctx = ctx;
		this.refresh();
		gitAPI.onDidOpenRepository((e) => this.refresh());
	}

	public refresh(): void {
		if (gitAPI.repositories.length === 0) {
			this.files = Promise.resolve([]);
			this._onDidChangeTreeData.fire();
			return;
		}

		const repository = gitAPI.repositories[0];
		const myConfig = <IMyConfig><any>vscode.workspace.getConfiguration('gitBranch');
		this.files = getMergeBase(repository).then((baseBranch) => {
			return getDiff(repository, baseBranch).then((diff) => {

				const exclude = createMatcher(myConfig.diffExcludes || []);

				const diffGroups: DiffGroup[] = (myConfig.diffGroups || []).map((element) => {
					return {
						name: element.name,
						test: createMatcher(element.files),
						entries: <DiffGroupEntry[]>[]
					}
				});
				diffGroups.unshift({ name: 'Default', test: () => true, entries: [] });

				// let entries = [];

				const lines = diff.split(/\r\n|\r|\n/);
				for (let i = 0; i < lines.length; i++) {
					const m = lines[i].match(/([\w])\s*(.*)$/);
					if (m) {
						const relativePath = m[2];

						if (exclude(relativePath)) {
							continue;
						}

						let kind = 'modified' as 'modified' | 'added';
						if (m[1] === 'A') {
							kind = 'added';
						}

						const entryURI = vscode.Uri.file(path.join(repository.rootUri.fsPath, relativePath));
						const entry = {
							uri: entryURI,
							relativePath: relativePath,
							kind: kind,
							original: entryURI.with({
								scheme: 'gitfs',
								path: `${entryURI.path}.git`,
								query: qs.stringify({
									path: entryURI.fsPath,
									ref: baseBranch
								})
							})
						};

						// Find group
						let hasGroup = false;
						for (let j = diffGroups.length - 1; j >= 1; j--) {
							if (diffGroups[j].test(relativePath)) {
								diffGroups[j].entries.push(entry);
								hasGroup = true;
							}
						}
						if (!hasGroup) {
							// Add it to the default group
							diffGroups[0].entries.push(entry);
						}
					}
				}
				return diffGroups;
			});
		});
		this._onDidChangeTreeData.fire();

		function createPrefixMatch(prefix: string) {
			return function (teststr: string) {
				return teststr.substr(0, prefix.length) === prefix;
			}
		}

		function createExactMatch(str: string) {
			return function (teststr: string) {
				return teststr === str;
			}
		}

		function createMatcher(arr: string[]) {
			const matchers = arr.map(function (entry) {
				if (/\*\*$/.test(entry)) {
					return createPrefixMatch(entry.substr(0, entry.length - 2));
				}
				return createExactMatch(entry);
			});

			return function (teststr: string) {
				for (let i = 0; i < matchers.length; i++) {
					if (matchers[i](teststr)) {
						return true;
					}
				}
				return false;
			}
		}
	}

	public getTreeItem(element: DiffGroup | DiffGroupEntry) {

		if (isDiffGroup(element)) {
			// this is a group
			return new vscode.TreeItem(
				element.name,
				element.name === 'Default' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
			);
		}

		const left = element.original;
		const right = element.uri;

		const r = new vscode.TreeItem(element.relativePath)
		r.resourceUri = element.uri;
		r.iconPath = {
			light: this.ctx.asAbsolutePath(`resources/icons/light/status-${element.kind}.svg`),
			dark: this.ctx.asAbsolutePath(`resources/icons/dark/status-${element.kind}.svg`),
		};
		r.command = {
			title: 'Show diff',
			command: 'vscode.diff',
			arguments: [left, right, `${path.basename(element.relativePath)} (BRANCH)`]
		};
		return r;
	}

	public getChildren(element: DiffGroup | undefined) {
		if (!element) {
			return this.files;
		}
		return element.entries;
	}
}
