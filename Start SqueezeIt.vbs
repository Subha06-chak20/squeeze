' Start SqueezeIt without showing a black console window.
Option Explicit
Dim shell, fso, root, nodePath, serverPath, runCmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)
nodePath = fso.BuildPath(root, "node" & Chr(92) & "node.exe")
serverPath = fso.BuildPath(root, "app" & Chr(92) & "server.mjs")
shell.CurrentDirectory = root

If fso.FileExists(nodePath) Then
    runCmd = """" & nodePath & """ """ & serverPath & """"
    shell.Run runCmd, 0, False
Else
    ' Fall back to system Node.js on PATH if bundled engine is absent (e.g. freshly cloned git repo)
    Dim checkCode
    On Error Resume Next
    checkCode = shell.Run("cmd /c where node >nul 2>&1", 0, True)
    If checkCode = 0 Then
        runCmd = "cmd /c node """ & serverPath & """"
        shell.Run runCmd, 0, False
    Else
        MsgBox "Node.js was not found on your system." & vbCrLf & vbCrLf & _
               "Please install Node.js from https://nodejs.org or download the pre-packaged SqueezeIt release.", _
               vbExclamation, "SqueezeIt"
    End If
    On Error Goto 0
End If
