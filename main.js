
/// <reference path='node.d.ts'/>
/// <reference path='vscode.d.ts'/>
/// <reference path='git.d.ts'/>

const cp = require('child_process');
const path = require('path');
const vscode = require('vscode');

var gitAPI = null;
exports.activate = function () {
	gitAPI = vscode.extensions.getExtension('vscode.git').exports.getAPI(1);
	vscode.window.registerTreeDataProvider('git-branch', new TreeDataProvider());
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

function TreeDataProvider() {

	const repository = gitAPI.repositories[0];

	this.files = getDiff().then((diff) => {

		console.log(diff.substr(0, 10000));

		let files = [];
		const lines = diff.split(/\r\n|\r|\n/);
		for (let i = 0; i < lines.length; i++) {
			let m = lines[i].match(/diff --git a\/([^ ]+)/);
			if (m) {
				files.push(m[1]);
			}
		}
		return files.map(file => ({
			uri: vscode.Uri.file(path.join(repository.rootUri.fsPath, file)),
			relativePath: file
		}));
	});
}

TreeDataProvider.prototype.getTreeItem = function (element) {
	
	let left = element.uri.with({
		scheme: 'git',
		path: `${element.relativePath}.git`,
		query: JSON.stringify({
			path: element.uri.fsPath,
			ref: 'master'
		})
	});

	let right = element.uri;

	return {
		label: element.relativePath,
		resourceUri: element.uri,
		command: {
			command: 'vscode.diff',
			arguments: [left, right, `${path.basename(element.relativePath)} (BRANCH)`]
		}
	}
};

TreeDataProvider.prototype.getChildren = function (element) {
	return this.files;
};
