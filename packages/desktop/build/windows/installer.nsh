; installer.nsh — include via electron-builder's nsis.include

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

; Windows remembers an "Open with" choice as a UserChoice naming this ProgId,
; and that pin outlives any reinstall, so keep this value stable once shipped.
!define MT_PROGID "Wenlan.Document"

;======================================================================
; Course workspace folder (edu-client E3.0).
;
; The app resolves an empty `projectsRoot` to ~/WenlanProjects on the first
; teaching login; this page lets the installer seed a custom location. The
; chosen path is handed over as UTF-16LE so Chinese user names survive, and
; the app consumes it only while `projectsRoot` is still unset — reinstalling
; therefore never overwrites a location the user changed later in the app.

!ifndef BUILD_UNINSTALLER
Var mtProjectsDialog
Var mtProjectsField
Var mtProjectsBrowse
Var mtProjectsRoot
!endif

!macro customPageAfterChangeDir
  Page custom mtProjectsPageCreate mtProjectsPageLeave
!macroend

; 卸载器构建也 include 本文件，但不会插入页面；不包起来 NSIS 会因
; “未引用的安装函数” 警告（electron-builder 把警告当错误）中止。
!ifndef BUILD_UNINSTALLER
Function mtProjectsPageCreate
  ${If} $mtProjectsRoot == ""
    StrCpy $mtProjectsRoot "$PROFILE\WenlanProjects"
  ${EndIf}

  nsDialogs::Create 1018
  Pop $mtProjectsDialog
  ${If} $mtProjectsDialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 22u "课程工作区位置（教育功能使用，教师/学生登录后生效）"
  Pop $0
  ${NSD_CreateText} 0 24u 78% 12u "$mtProjectsRoot"
  Pop $mtProjectsField
  ${NSD_CreateButton} 80% 24u 20% 12u "浏览…"
  Pop $mtProjectsBrowse
  ${NSD_OnClick} $mtProjectsBrowse mtProjectsBrowse

  ${NSD_CreateLabel} 0 44u 100% 22u "可保留默认；稍后也可在文览「教学」菜单中更换。"
  Pop $0

  nsDialogs::Show
FunctionEnd

Function mtProjectsBrowse
  ${NSD_GetText} $mtProjectsField $0
  nsDialogs::SelectFolderDialog "选择课程工作区目录" "$0"
  Pop $1
  ${If} $1 != error
    ${NSD_SetText} $mtProjectsField "$1"
  ${EndIf}
FunctionEnd

Function mtProjectsPageLeave
  ${NSD_GetText} $mtProjectsField $mtProjectsRoot
FunctionEnd
!endif

;======================================================================
; Markdown file associations.
;
; These must be written on every install and removed only on a real uninstall.
; electron-builder runs the previous version's uninstaller silently before it
; installs, so unregistering there unconditionally while registering only
; behind a prompt left any update or reinstall answered "No" with a UserChoice
; pointing at a ProgId that no longer existed, and Explorer's double-click did
; nothing at all (#4966).

; The "Open with" dialog builds its UserChoice from OpenWithProgids, so
; without that entry Windows pins the ProgId electron-builder registers from
; `fileAssociations` rather than this one.
!macro mtAssociateExtension EXT
  WriteRegStr SHELL_CONTEXT "Software\Classes\${EXT}" "" "${MT_PROGID}"
  WriteRegNone SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${MT_PROGID}"
!macroend

; The extension key also carries the OpenWithProgids entries of every other
; Markdown editor the user has installed, so only Wenlan's own values go.
!macro mtUnassociateExtension EXT
  DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}\OpenWithProgids" "${MT_PROGID}"
  Push $0
  ReadRegStr $0 SHELL_CONTEXT "Software\Classes\${EXT}" ""
  ${if} $0 == "${MT_PROGID}"
    DeleteRegValue SHELL_CONTEXT "Software\Classes\${EXT}" ""
  ${endIf}
  Pop $0
!macroend

;======================================================================
; customInstall macro is invoked by electron-builder after files are in $INSTDIR
!macro customInstall
  !insertmacro mtAssociateExtension ".md"
  !insertmacro mtAssociateExtension ".markdown"
  !insertmacro mtAssociateExtension ".mmd"
  !insertmacro mtAssociateExtension ".mdown"
  !insertmacro mtAssociateExtension ".mdtxt"
  !insertmacro mtAssociateExtension ".mdtext"
  !insertmacro mtAssociateExtension ".mdx"

  WriteRegStr SHELL_CONTEXT "Software\Classes\${MT_PROGID}" \
    "" "Wenlan Markdown Document"
  WriteRegExpandStr SHELL_CONTEXT "Software\Classes\${MT_PROGID}\DefaultIcon" \
    "" "$INSTDIR\resources\icons\md.ico,0"
  WriteRegExpandStr SHELL_CONTEXT "Software\Classes\${MT_PROGID}\shell\open\command" \
    "" '"$INSTDIR\wenlan.exe" "%1"'

  ; electron-builder writes the command for its own ProgId — `Markdown`, the
  ; `fileAssociations[].name` in electron-builder.yml — with the executable
  ; path unquoted, which runs `C:\Program` when the directory the user picked
  ; during setup contains a space.
  WriteRegStr SHELL_CONTEXT "Software\Classes\Markdown\shell\open\command" \
    "" '"$INSTDIR\wenlan.exe" "%1"'

  ; Explorer serves file types from a cache that a fresh install otherwise
  ; keeps until the next sign-in.
  System::Call 'shell32::SHChangeNotify(i, i, i, i) v (0x08000000, 0, 0, 0)'

  ; 交接文件：首次启动由 app 读取并转成项目偏好。静默安装/更新没有页面，
  ; $mtProjectsRoot 为空 ⇒ 不写，沿用用户已有设置。
  ${If} $mtProjectsRoot != ""
    CreateDirectory "$APPDATA\wenlan"
    ClearErrors
    FileOpen $0 "$APPDATA\wenlan\installer-projects.txt" w
    ${IfNot} ${Errors}
      FileWriteUTF16LE /BOM $0 "$mtProjectsRoot"
      FileClose $0
    ${EndIf}
  ${EndIf}
!macroend

;======================================================================
; customUnInstall macro cleans up on uninstall
!macro customUnInstall
  ; An update reaches here through the old uninstaller, right before the new
  ; version registers the association again.
  ${ifNot} ${isUpdated}
    !insertmacro mtUnassociateExtension ".md"
    !insertmacro mtUnassociateExtension ".markdown"
    !insertmacro mtUnassociateExtension ".mmd"
    !insertmacro mtUnassociateExtension ".mdown"
    !insertmacro mtUnassociateExtension ".mdtxt"
    !insertmacro mtUnassociateExtension ".mdtext"
    !insertmacro mtUnassociateExtension ".mdx"
    DeleteRegKey SHELL_CONTEXT "Software\Classes\${MT_PROGID}"
  ${endIf}

  MessageBox MB_YESNO "Do you want to delete user settings?" /SD IDNO IDNO SkipRemoval
    SetShellVarContext current
    RMDir /r "$APPDATA\wenlan"
  SkipRemoval:
!macroend
