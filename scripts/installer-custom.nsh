!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!define HAMSTER_INSTALL_DIRECTORY "Hamster Archiver"

!macro customUnInstall
  ; Remove every exact shortcut name used by supported Hamster Archiver
  ; installers. This also cleans up a stale link left by an older or
  ; interrupted uninstall without touching user-created shortcuts.
  WinShell::UninstShortcut "$DESKTOP\Hamster Archiver.lnk"
  Delete "$DESKTOP\Hamster Archiver.lnk"
  WinShell::UninstShortcut "$DESKTOP\HamsterArchiver.lnk"
  Delete "$DESKTOP\HamsterArchiver.lnk"
  WinShell::UninstShortcut "$SMPROGRAMS\Hamster Archiver.lnk"
  Delete "$SMPROGRAMS\Hamster Archiver.lnk"
  WinShell::UninstShortcut "$SMPROGRAMS\HamsterArchiver.lnk"
  Delete "$SMPROGRAMS\HamsterArchiver.lnk"
!macroend

!ifndef BUILD_UNINSTALLER

Var HamsterDesktopShortcutCheckbox
Var HamsterInstallPathLabel

Function HamsterNormalizeInstallDirectory
  StrCpy $0 "$INSTDIR" 1 -1
  ${If} $0 == "\"
    StrCpy $INSTDIR "$INSTDIR" -1
  ${EndIf}
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "${HAMSTER_INSTALL_DIRECTORY}"
    StrCpy $INSTDIR "$INSTDIR\${HAMSTER_INSTALL_DIRECTORY}"
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  ; Define these callbacks when electron-builder expands the page macro. At
  ; that point its update-detection plug-in is available to skip this page for
  ; in-place upgrades while keeping it visible for a fresh installation.
  Function HamsterInstallDirectoryPre
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    ; electron-builder initializes a fresh per-user install with APP_FILENAME.
    ; Present the friendly product folder instead of nesting another directory.
    ${GetFileName} "$INSTDIR" $0
    ${If} $0 == "${APP_FILENAME}"
      ${GetParent} "$INSTDIR" $0
      StrCpy $INSTDIR "$0\${HAMSTER_INSTALL_DIRECTORY}"
    ${EndIf}
  FunctionEnd

  Function HamsterInstallDirectoryLeave
    Call HamsterNormalizeInstallDirectory
  FunctionEnd

  !define MUI_PAGE_CUSTOMFUNCTION_PRE HamsterInstallDirectoryPre
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE HamsterInstallDirectoryLeave
  ; MUI consumes and undefines these callbacks when inserting the page.
  !insertmacro MUI_PAGE_DIRECTORY

  Function HamsterInstallOptionsCreate
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    Call HamsterNormalizeInstallDirectory
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 0 100% 22u "Hamster Archiver 将安装到 / will be installed to:"
    Pop $0
    ${NSD_CreateLabel} 0 25u 100% 28u "$INSTDIR"
    Pop $HamsterInstallPathLabel
    ${NSD_CreateCheckbox} 0 68u 100% 18u "创建桌面快捷方式 / Create a desktop shortcut"
    Pop $HamsterDesktopShortcutCheckbox
    ${NSD_Check} $HamsterDesktopShortcutCheckbox
    nsDialogs::Show
  FunctionEnd

  Function HamsterInstallOptionsLeave
    Call HamsterNormalizeInstallDirectory
  FunctionEnd

  Page custom HamsterInstallOptionsCreate HamsterInstallOptionsLeave
!macroend

!macro customInstall
  ${IfNot} ${isUpdated}
    ${NSD_GetState} $HamsterDesktopShortcutCheckbox $0
    ${If} $0 != ${BST_CHECKED}
      Delete "$newDesktopLink"
    ${EndIf}
  ${EndIf}
!macroend

!macro customFinishPage
  Function HamsterStartInstalledApp
    ${If} ${isUpdated}
      StrCpy $1 "--updated"
    ${Else}
      StrCpy $1 ""
    ${EndIf}
    ; Assisted installs are per-user and do not elevate the main installer, so
    ; the built-in ExecShell starts the executable in the correct user session.
    ExecShell "open" "$INSTDIR\${PRODUCT_FILENAME}.exe" "$1" SW_SHOWNORMAL
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_TEXT "运行 Hamster Archiver / Run Hamster Archiver"
  !define MUI_FINISHPAGE_RUN_FUNCTION "HamsterStartInstalledApp"
  !insertmacro MUI_PAGE_FINISH
!macroend

!endif
