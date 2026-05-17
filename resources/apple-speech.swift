import Foundation
import Speech

guard CommandLine.arguments.count >= 2 else {
    fputs("usage: apple-speech <audio-file> [locale]\n", stderr)
    exit(2)
}

let audioURL = URL(fileURLWithPath: CommandLine.arguments[1])
let localeId = CommandLine.arguments.count >= 3 ? CommandLine.arguments[2] : "ja-JP"
let locale = Locale(identifier: localeId)

guard FileManager.default.fileExists(atPath: audioURL.path) else {
    fputs("audio file not found: \(audioURL.path)\n", stderr)
    exit(2)
}

guard let recognizer = SFSpeechRecognizer(locale: locale) else {
    fputs("speech recognizer unavailable for locale: \(localeId)\n", stderr)
    exit(3)
}

guard recognizer.supportsOnDeviceRecognition else {
    fputs("on-device recognition is not supported for locale: \(localeId)\n", stderr)
    exit(4)
}

let authSem = DispatchSemaphore(value: 0)
var authStatus = SFSpeechRecognizerAuthorizationStatus.notDetermined
SFSpeechRecognizer.requestAuthorization { status in
    authStatus = status
    authSem.signal()
}
_ = authSem.wait(timeout: .now() + 15)

guard authStatus == .authorized else {
    fputs("speech recognition authorization is not granted: \(authStatus.rawValue)\n", stderr)
    exit(5)
}

let request = SFSpeechURLRecognitionRequest(url: audioURL)
request.requiresOnDeviceRecognition = true
request.shouldReportPartialResults = false
request.taskHint = .dictation

let resultSem = DispatchSemaphore(value: 0)
var finalText = ""
var finalError: Error?

let task = recognizer.recognitionTask(with: request) { result, error in
    if let result {
        finalText = result.bestTranscription.formattedString
        if result.isFinal {
            resultSem.signal()
        }
    }
    if let error {
        finalError = error
        resultSem.signal()
    }
}

if resultSem.wait(timeout: .now() + 60) == .timedOut {
    task.cancel()
    fputs("speech recognition timed out\n", stderr)
    exit(6)
}

if let finalError {
    fputs("\(finalError.localizedDescription)\n", stderr)
    exit(7)
}

print(finalText.trimmingCharacters(in: .whitespacesAndNewlines))
