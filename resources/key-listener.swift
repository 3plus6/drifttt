import Cocoa

// アクセシビリティ権限チェック（プロンプト表示付き）
let options = [kAXTrustedCheckOptionPrompt.takeRetainedValue() as String: true] as CFDictionary
if !AXIsProcessTrustedWithOptions(options) {
    fputs("ERROR: Accessibility permission required\n", stderr)
    exit(1)
}

var isDown = false

// NSEvent でグローバルキー監視
// CGEventTapと違い「入力監視」権限が不要（アクセシビリティ権限のみでOK）
NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged) { event in
    let keyCode = event.keyCode
    let cmdPressed = event.modifierFlags.contains(.command)

    // 右Cmd = keyCode 54
    if keyCode == 54 {
        if cmdPressed && !isDown {
            isDown = true
            print("KEY_DOWN")
            fflush(stdout)
        } else if !cmdPressed && isDown {
            isDown = false
            print("KEY_UP")
            fflush(stdout)
        }
    }

    // 別キーでCmdが離された場合の安全策
    if !cmdPressed && isDown {
        isDown = false
        print("KEY_UP")
        fflush(stdout)
    }
}

print("READY")
fflush(stdout)

// NSApplication run loop
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
app.run()
