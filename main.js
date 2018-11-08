
/// <reference path='node.d.ts'/>
/// <reference path='vscode.d.ts'/>
/// <reference path='git.d.ts'/>

const cp = require('child_process');
const path = require('path');
const vscode = require('vscode');

var gitAPI = null;
exports.activate = function (ctx) {
	gitAPI = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
	vscode.window.registerTreeDataProvider('git-branch', new TreeDataProvider(ctx));
}

function getDiff() {
	const repository = gitAPI.repositories[0];
	return new Promise((c, e) => {
		cp.exec(
			`${gitAPI.git.path} diff master HEAD`,
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

function TreeDataProvider(ctx) {

	function createPrefixMatch(prefix) {
		return function(teststr) {
			return teststr.substr(0, prefix.length) === prefix;
		}
	}

	function createExactMatch(str) {
		return function(teststr) {
			return teststr === str;
		}
	}

	function createMatcher(arr) {
		const matchers = arr.map(function(entry) {
			if (/\*\*$/.test(entry)) {
				return createPrefixMatch(entry.substr(0, entry.length - 2));
			}
			return createExactMatch(entry);
		});

		return function(teststr) {
			for (let i = 0; i < matchers.length; i++) {
				if (matchers[i](teststr)) {
					return true;
				}
			}
			return false;
		}
	}

	this.ctx = ctx;

	const repository = gitAPI.repositories[0];

	this.files = getDiff().then((diff) => {
		
		const myConfig = vscode.workspace.getConfiguration('gitBranch');
		let exclude = createMatcher(myConfig.diffExcludes || []);

		let diffGroups = (myConfig.diffGroups || []).map((element) => {
			return {
				name: element.name,
				test: createMatcher(element.files)
			}
		});

		// console.log(diff.substr(0, 10000));

		let entries = [];
		const lines = diff.split(/\r\n|\r|\n/);
		for (let i = 0; i < lines.length; i++) {
			let m = lines[i].match(/diff --git a\/([^ ]+)/);
			if (m) {
				let relativePath = m[1];

				if (exclude(relativePath)) {
					continue;
				}

				let kind = 'modified';
				if (i + 1 < lines.length) {
					if (/^new file/.test(lines[i + 1])) {
						kind = 'added';
					}
				}
				entries.push({
					uri: vscode.Uri.file(path.join(repository.rootUri.fsPath, relativePath)),
					relativePath: relativePath,
					kind: kind
				});
			}
		}
		return entries;
	});
}

TreeDataProvider.prototype.getTreeItem = function (element) {
	
	let left = element.uri.with({
		scheme: 'git',
		path: element.relativePath,
		query: JSON.stringify({
			path: element.uri.fsPath,
			ref: 'master'
		})
	});

	let right = element.uri;

	return {
		label: element.relativePath,
		resourceUri: element.uri,
		iconPath: {
			light: this.ctx.asAbsolutePath(`resources/icons/light/status-${element.kind}.svg`),
			dark: this.ctx.asAbsolutePath(`resources/icons/dark/status-${element.kind}.svg`),
		},
		command: {
			command: 'vscode.diff',
			arguments: [left, right, `${path.basename(element.relativePath)} (BRANCH)`]
		}
	}
};

TreeDataProvider.prototype.getChildren = function (element) {
	return this.files;
};
