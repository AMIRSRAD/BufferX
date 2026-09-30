; Tauri stages the vcpkg OpenSSL runtime next to the executable. Its MSI
; bundler picks up that DLL automatically; NSIS needs an explicit copy.
!macro NSIS_HOOK_POSTINSTALL
  !searchreplace OPENSSL_DLL_PATH "${MAINBINARYSRCPATH}" "${MAINBINARYNAME}.exe" "libcrypto-*.dll"
  SetOutPath "$INSTDIR"
  File "${OPENSSL_DLL_PATH}"
  !undef OPENSSL_DLL_PATH
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\libcrypto-3-*.dll"
!macroend
