!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh

!ifndef BUILD_UNINSTALLER

Var HamsterDesktopShortcutCheckbox
Var HamsterInstallPathLabel

Function HamsterNormalizeInstallDirectory
  StrCpy $0 "$INSTDIR" 1 -1
  ${If} $0 == "\"
    StrCpy $INSTDIR "$INSTDIR" -1
  ${EndIf}
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "${APP_FILENAME}"
    StrCpy $INSTDIR "$INSTDIR\${APP_FILENAME}"
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  ; Define these callbacks when electron-builder expands the page macro. At
  ; that point its update-detection plug-in is available to skip this page for
  ; in-place upgrades while keeping it visible for a fresh installation.
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
