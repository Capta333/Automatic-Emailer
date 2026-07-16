' Creates an "Email Campaigner" desktop shortcut that runs the launcher minimized.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

proj = "C:\Users\Micah Walsman\email-campaigner"
target = proj & "\launch-campaigner.cmd"

desktops = Array( _
  "C:\Users\Micah Walsman\Desktop", _
  "C:\Users\Micah Walsman\OneDrive\Desktop")

made = 0
For Each dt In desktops
  If fso.FolderExists(dt) Then
    Set lnk = sh.CreateShortcut(dt & "\Email Campaigner.lnk")
    lnk.TargetPath = target
    lnk.WorkingDirectory = proj
    lnk.WindowStyle = 7            ' run minimized
    lnk.Description = "Launch the Email Campaigner app"
    lnk.IconLocation = "%SystemRoot%\System32\shell32.dll,265"
    lnk.Save
    made = made + 1
    WScript.Echo "Created: " & dt & "\Email Campaigner.lnk"
  End If
Next
WScript.Echo "Done. Shortcuts created: " & made
