; LocalLLM Studio v2.2.1 - Windows installer (NSIS, per-user, no admin required)
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define APPNAME "LocalLLM Studio"
!define APPVERSION "2.2.1"
!define COMPANY "LocalLLM"
!define APPEXE "LocalLLM Studio.exe"
!define ESTSIZE 460000

Name "${APPNAME}"
OutFile "LocalLLM-Studio-Setup-${APPVERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\LocalLLM Studio"
InstallDirRegKey HKCU "Software\${APPNAME}" "InstallDir"
RequestExecutionLevel user
SetCompressor zlib
ManifestDPIAware true

; ---- MUI setup ----
!define MUI_ICON "icon.ico"
!define MUI_UNICON "icon.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APPEXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APPNAME}"
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_LINK "Hardware note: chat & image generation use your iGPU via Vulkan automatically"
!define MUI_FINISHPAGE_LINK_LOCATION "https://github.com/ggml-org/llama.cpp"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function .onInit
  ; kill running instances so files can be replaced
  ExecWait 'taskkill /IM "${APPEXE}" /F' $0
FunctionEnd

Section "Install" SecCore
  SetOutPath "$INSTDIR"
  File /r "${UNPACKED}\*.*"

  ; uninstaller + registry
  WriteUninstaller "$INSTDIR\Uninstall ${APPNAME}.exe"
  WriteRegStr HKCU "Software\${APPNAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${APPVERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\resources\icon.ico"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" '"$INSTDIR\Uninstall ${APPNAME}.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "EstimatedSize" ${ESTSIZE}
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1

  ; start menu
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\resources\icon.ico" 0
  CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" "$INSTDIR\Uninstall ${APPNAME}.exe" "" "$INSTDIR\resources\icon.ico" 0
  ; desktop
  CreateShortCut "$DESKTOP\${APPNAME}.lnk" "$INSTDIR\${APPEXE}" "" "$INSTDIR\resources\icon.ico" 0
SectionEnd

Section "Uninstall"
  ExecWait 'taskkill /IM "${APPEXE}" /F' $0
  RMDir /REBOOTOK /r "$INSTDIR"
  RMDir /REBOOTOK /r "$SMPROGRAMS\${APPNAME}"
  Delete /REBOOTOK "$DESKTOP\${APPNAME}.lnk"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"
  DeleteRegKey HKCU "Software\${APPNAME}"
SectionEnd
