import Cocoa

// stdin からテキストを読み取り、CGEvents で直接入力（クリップボード不使用）
guard let data = try? FileHandle.standardInput.availableData,
      let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .newlines),
      !text.isEmpty else {
    exit(0)
}

let src = CGEventSource(stateID: .hidSystemState)

// テキストを小さなチャンクに分割して入力。
// 一部のElectron/ブラウザ系入力欄は大きいUnicodeイベントを取りこぼすため、
// 速度より安定性を優先する。
let chunkSize = 6
var index = text.startIndex

while index < text.endIndex {
    let end = text.index(index, offsetBy: chunkSize, limitedBy: text.endIndex) ?? text.endIndex
    let chunk = String(text[index..<end])
    var chars = Array(chunk.utf16)

    let keyDown = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)!
    let keyUp = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)!

    keyDown.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)
    keyUp.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)

    keyDown.post(tap: .cgAnnotatedSessionEventTap)
    keyUp.post(tap: .cgAnnotatedSessionEventTap)

    usleep(30_000) // 30ms between chunks
    index = end
}
