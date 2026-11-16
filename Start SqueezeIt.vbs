' Start SqueezeIt without showing a black console window.
Option Explicit
Dim shell, fso, root, nodePath, serverPath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = fso.BuildPath(root, "node" & Chr(92) & "node.exe")
serverPath = fso.BuildPath(root, "app" & Chr(92) & "server.mjs")
shell.CurrentDirectory = root
shell.Run """" & nodePath & """ """ & serverPath & """", 0, False
