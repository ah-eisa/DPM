import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots=["app","lib","tests","scripts"],extensions=new Set([".ts",".tsx",".js",".mjs"]),issues=[];
function walk(dir){if(!fs.existsSync(dir))return;for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory())walk(full);else if(extensions.has(path.extname(entry.name)))check(full);}}
function check(file){const text=fs.readFileSync(file,"utf8"),lines=text.split(/\r?\n/);lines.forEach((line,i)=>{if(/[ \t]+$/.test(line))issues.push(`${file}:${i+1}: trailing whitespace`);if(line.includes("\t"))issues.push(`${file}:${i+1}: tab character`);if(line.includes("@ts-ignore"))issues.push(`${file}:${i+1}: @ts-ignore is not allowed`);});const kind=file.endsWith(".tsx")?ts.ScriptKind.TSX:file.endsWith(".ts")?ts.ScriptKind.TS:ts.ScriptKind.JS;const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,kind);for(const diagnostic of source.parseDiagnostics){const pos=diagnostic.start==null?{line:0,character:0}:source.getLineAndCharacterOfPosition(diagnostic.start);issues.push(`${file}:${pos.line+1}:${pos.character+1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText," ")}`);}function visit(node){if(node.kind===ts.SyntaxKind.DebuggerStatement){const pos=source.getLineAndCharacterOfPosition(node.getStart(source));issues.push(`${file}:${pos.line+1}: debugger statement is not allowed`);}ts.forEachChild(node,visit);}visit(source);}
for(const root of roots)walk(root);
if(issues.length){console.error(issues.join("\n"));process.exit(1);}console.log("Lint checks passed");
