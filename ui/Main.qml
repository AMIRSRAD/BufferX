import QtQuick 2.15
import QtQuick.Controls 2.15
import QtQuick.Layouts 1.15
import QtQuick.Window 2.15

ApplicationWindow {
    id: root
    width: 1200
    height: 700
    x: (Screen.width - width) / 2
    y: (Screen.height - height) / 2
    visible: true
    title: "BufferX - ISO 8583 Studio"
    font.family: "Segoe UI"

    property color ink: "#FFFFFF"
    property color muted: "#D2DAE3"
    property color accent: "#4DD4C6"
    property color accentSoft: "#244B49"
    property color accentCool: "#88F2D0"
    property color card: "#17202A"
    property color cardAlt: "#1E2833"
    property color border: "#425160"
    property color backgroundTop: "#10161E"
    property color backgroundBottom: "#0E141B"
    property int fieldRowHeight: 37
    property int fieldRowSpacing: 2
    property int fieldLabelWidth: 440
    property int fieldValueWidth: 180
    property int fieldActionWidth: 26
    property int fieldHexWidth: 28

    property var packagerList: []
    property var fieldDefs: []
    property var packagerMacFieldIds: []
    property string activePackager: ""
    property string packagerMacMethod: ""
    property int packagerMacSize: 0
    property bool packagerMacSupported: false
    property string lastError: ""
    property string macResultHex: ""
    property string macVerifyStatus: ""
    property string tlvTreeText: ""
    property string tlvInlineText: ""
    property real intro: 0
    property string packagerPathValue: ""
    property int selectedBufferIndex: -1
    property string currentBufferPath: ""
    property int lastEncodingIndex: 0
    property bool encodingGuard: false
    property bool settingsOpen: false
    property bool macOpen: false
    property bool cryptoOpen: false
    property bool tlvOpen: false
    property int settingsWidth: 320
    property int cursorLine: 1
    property int cursorCol: 1
    property int cursorPos: 1
    property int selectionLen: 0
    property string activeEditor: "buffer"

    onSelectedBufferIndexChanged: {
        if (bufferSwitcher && bufferSwitcher.currentIndex !== selectedBufferIndex) {
            bufferSwitcher.currentIndex = selectedBufferIndex
        }
    }

    component AppButton: Button {
        id: control
        font.pixelSize: 12
        padding: 10
        hoverEnabled: true
        background: Rectangle {
            radius: 8
            color: control.down ? "#253545" : (control.hovered ? "#223140" : "#1B2530")
            border.color: root.border
            border.width: 1
        }
        contentItem: Label {
            text: control.text
            font.pixelSize: control.font.pixelSize
            color: control.enabled ? root.ink : root.muted
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
            elide: Text.ElideRight
        }
    }

    ListModel { id: fieldModel }
    ListModel { id: bufferModel }

    function parseJsonSafe(text) {
        try {
            return JSON.parse(text)
        } catch (e) {
            return { ok: false, error: "Invalid JSON response." }
        }
    }

    function baseName(path) {
        if (!path) {
            return ""
        }
        var parts = path.split(/[/\\\\]/)
        return parts.length ? parts[parts.length - 1] : path
    }

    function stripHex(input) {
        return input.replace(/[^0-9a-fA-F]/g, "")
    }

    function hexToAscii(hexText) {
        var out = ""
        for (var i = 0; i + 1 < hexText.length; i += 2) {
            var byteValue = parseInt(hexText.substr(i, 2), 16)
            out += String.fromCharCode(byteValue)
        }
        return out
    }

    function bytesToHex(bytes) {
        var out = ""
        for (var i = 0; i < bytes.length; ++i) {
            var hex = bytes[i].toString(16).toUpperCase()
            if (hex.length < 2) {
                hex = "0" + hex
            }
            out += hex
        }
        return out
    }

    function fieldIndexById(idValue) {
        for (var i = 0; i < fieldModel.count; ++i) {
            if (fieldModel.get(i).fieldId === idValue) {
                return i
            }
        }
        return -1
    }

    function isHexLike(text) {
        if (!text) {
            return null
        }
        var trimmed = text.trim()
        if (trimmed.length === 0) {
            return null
        }
        return /^[0-9a-fA-F]+$/.test(trimmed)
    }

    function syncBufferEncodingFromInput() {
        if (encodingGuard) {
            return
        }
        var hexLike = isHexLike(decodeInput.text)
        if (hexLike === null) {
            return
        }
        var targetIndex = hexLike ? 0 : 1
        if (bufferEncoding.currentIndex !== targetIndex) {
            encodingGuard = true
            bufferEncoding.currentIndex = targetIndex
            encodingGuard = false
            lastEncodingIndex = targetIndex
        }
    }

    function convertHexToString() {
        var converted = parseJsonSafe(backend.hexToUtf8(decodeInput.text))
        if (!converted.ok) {
            lastError = converted.error || "Invalid hex input."
            return
        }
        if (fieldsContainNonAscii()) {
            lastError = "String mode does not support non-ASCII characters in fields. Switch to Hex."
            return
        }
        if (hasNonAscii(converted.text)) {
            lastError = "String mode does not support non-ASCII characters. Switch to Hex."
            return
        }
        decodeInput.text = converted.text
        syncBufferEncodingFromInput()
    }

    function convertStringToHex() {
        decodeInput.text = backend.utf8ToHex(decodeInput.text)
        syncBufferEncodingFromInput()
    }

    function hasNonAscii(text) {
        if (!text) {
            return false
        }
        for (var i = 0; i < text.length; ++i) {
            if (text.charCodeAt(i) > 127) {
                return true
            }
        }
        return false
    }

    function hasEdgeSpace(text) {
        if (!text || text.length === 0) {
            return false
        }
        return text.charAt(0) === " " || text.charAt(text.length - 1) === " "
    }

    function fieldsContainNonAscii() {
        for (var i = 0; i < fieldModel.count; ++i) {
            var entry = fieldModel.get(i)
            if (!entry.showHex && hasNonAscii(entry.value)) {
                return true
            }
        }
        return false
    }

    function updateCursorStatus() {
        updateCursorStatusFrom(decodeInput.text || "", decodeInput.cursorPosition,
                               decodeInput.selectionStart, decodeInput.selectionEnd, true)
    }

    function updateCursorStatusFrom(text, cursorPosition, selStart, selEnd, multiline) {
        var pos = cursorPosition
        if (pos < 0) {
            pos = 0
        }
        cursorPos = pos + 1
        if (multiline) {
            var before = text.substring(0, pos)
            var lines = before.split("\n")
            cursorLine = lines.length
            cursorCol = lines[lines.length - 1].length + 1
        } else {
            cursorLine = 1
            cursorCol = pos + 1
        }
        selectionLen = Math.abs((selEnd || 0) - (selStart || 0))
    }

    function parseHeaderLengthFromInput(input, isHex, mode, size) {
        if (size <= 0) {
            return { ok: false }
        }
        if (isHex) {
            var compact = stripHex(input)
            if (compact.length < size * 2) {
                return { ok: false }
            }
            if (compact.length % 2 !== 0) {
                return { ok: false }
            }
            var headerHex = compact.substr(0, size * 2)
            if (mode === "ascii") {
                var ascii = hexToAscii(headerHex)
                if (!/^[0-9]+$/.test(ascii)) {
                    return { ok: false }
                }
                return { ok: true, length: parseInt(ascii, 10), totalBytes: compact.length / 2 }
            }
            if (mode === "binary") {
                var value = 0
                for (var i = 0; i < size; ++i) {
                    value = (value << 8) | parseInt(headerHex.substr(i * 2, 2), 16)
                }
                return { ok: true, length: value, totalBytes: compact.length / 2 }
            }
            return { ok: false }
        }

        if (input.length < size) {
            return { ok: false }
        }
        if (mode === "ascii") {
            var header = input.substr(0, size)
            if (!/^[0-9]+$/.test(header)) {
                return { ok: false }
            }
            return { ok: true, length: parseInt(header, 10), totalBytes: input.length }
        }
        if (mode === "binary") {
            var total = 0
            for (var j = 0; j < size; ++j) {
                total = (total << 8) | input.charCodeAt(j)
            }
            return { ok: true, length: total, totalBytes: input.length }
        }
        return { ok: false }
    }

    function addLengthHeaderIfMissing() {
        var mode = headerMode.currentText.toLowerCase()
        if (headerAuto.checked) {
            mode = headerMode.currentText.toLowerCase()
        }
        var size = headerSize.value
        if (size <= 0) {
            lastError = "Header size must be positive."
            return
        }
        if (mode !== "ascii" && mode !== "binary") {
            lastError = "Select ASCII or Binary for length header."
            return
        }

        var input = decodeInput.text
        var isHex = bufferEncoding.currentIndex === 0
        var parsed = parseHeaderLengthFromInput(input, isHex, mode, size)
        if (parsed.ok && (size + parsed.length) === parsed.totalBytes) {
            lastError = "Length header already present."
            return
        }

        var payloadBytes = isHex ? (stripHex(input).length / 2) : input.length
        if (payloadBytes < 0) {
            lastError = "Buffer is empty."
            return
        }

        if (mode === "ascii") {
            var lengthStr = payloadBytes.toString()
            while (lengthStr.length < size) {
                lengthStr = "0" + lengthStr
            }
            if (lengthStr.length > size) {
                lastError = "Length exceeds header size."
                return
            }
            if (isHex) {
                var hexHeader = bytesToHex(lengthStr.split("").map(function(ch) { return ch.charCodeAt(0) }))
                decodeInput.text = hexHeader + stripHex(input)
            } else {
                decodeInput.text = lengthStr + input
            }
        } else {
            if (!isHex) {
                var bytes = []
                for (var i = size - 1; i >= 0; --i) {
                    bytes[i] = payloadBytes & 0xFF
                    payloadBytes = payloadBytes >> 8
                }
                decodeInput.text = String.fromCharCode.apply(String, bytes) + input
            } else {
                var bytesHex = []
                var value = payloadBytes
                for (var k = size - 1; k >= 0; --k) {
                    bytesHex[k] = value & 0xFF
                    value = value >> 8
                }
                decodeInput.text = bytesToHex(bytesHex) + stripHex(input)
            }
        }
        headerEnabled.checked = true
        lastError = ""
    }

    function addBufferEntry(path) {
        if (!path) {
            return
        }
        for (var i = 0; i < bufferModel.count; ++i) {
            if (bufferModel.get(i).path === path) {
                bufferModel.set(i, {
                    name: baseName(path),
                    path: path
                })
                selectedBufferIndex = i
                currentBufferPath = path
                return
            }
        }
        bufferModel.append({
            name: baseName(path),
            path: path
        })
        selectedBufferIndex = bufferModel.count - 1
        currentBufferPath = path
    }

    function openBufferFile() {
        var path = backend.chooseBufferOpenFile()
        if (path && path.length) {
            loadBufferFromPath(path)
        }
    }

    function saveBufferAs() {
        var path = backend.chooseBufferSaveFile()
        if (path && path.length) {
            saveBufferToPath(path)
        }
    }

    function saveCurrentBuffer() {
        if (currentBufferPath && currentBufferPath.length) {
            saveBufferToPath(currentBufferPath)
            return
        }
        saveBufferAs()
    }

    function selectBufferAt(index) {
        if (index < 0 || index >= bufferModel.count) {
            return
        }
        var entry = bufferModel.get(index)
        selectedBufferIndex = index
        loadBufferFromPath(entry.path)
    }

    function closeToolPanels(exceptName) {
        settingsOpen = exceptName === "settings" ? settingsOpen : false
        macOpen = exceptName === "mac" ? macOpen : false
        cryptoOpen = exceptName === "crypto" ? cryptoOpen : false
        tlvOpen = exceptName === "tlv" ? tlvOpen : false
    }

    function toggleFieldHex(index) {
        var item = fieldModel.get(index)
        if (!item) {
            return
        }
        if (isBinaryField(item.fieldId)) {
            return
        }
        if (item.showHex) {
            var converted = parseJsonSafe(backend.hexToUtf8(item.value))
            if (!converted.ok) {
                lastError = converted.error || "Invalid hex input."
                return
            }
            fieldModel.set(index, { "value": converted.text, "showHex": false })
        } else {
            var hexText = backend.utf8ToHex(item.value)
            fieldModel.set(index, { "value": hexText, "showHex": true })
        }
    }

    function loadPackagers(path) {
        var response = parseJsonSafe(backend.loadPackagerFile(path))
        if (!response.ok) {
            lastError = response.error
            return
        }
        packagerList = response.packagers
        packagerCombo.model = packagerList
        if (packagerList.length > 0) {
            packagerCombo.currentIndex = 0
            activePackager = packagerList[0]
            loadPackagerFields()
        }
    }

    function loadPackagerFields() {
        if (!activePackager) {
            return
        }
        var response = parseJsonSafe(backend.packagerFieldsJson(activePackager))
        if (!response.ok) {
            lastError = response.error
            return
        }
        fieldDefs = response.fields
        packagerMacFieldIds = response.macFieldIds || []
        packagerMacMethod = response.macMethod || ""
        packagerMacSize = response.macSize || 0
        packagerMacSupported = response.macSupported === true
        if (response.lenLen > 0) {
            headerSize.value = response.lenLen
        }
        if (packagerMacFieldIds.length > 0) {
            macFieldId.value = packagerMacFieldIds[0]
        }
        macResultHex = ""
        macVerifyStatus = ""
        rebuildFieldModel()
    }

    function findFieldDef(idValue) {
        for (var i = 0; i < fieldDefs.length; ++i) {
            if (fieldDefs[i].id === idValue) {
                return fieldDefs[i]
            }
        }
        return null
    }

    function fieldTypeOf(idValue) {
        var def = findFieldDef(idValue)
        return def ? def.type : ""
    }

    function isBinaryField(idValue) {
        return fieldTypeOf(idValue) === "Binary"
    }

    function rebuildFieldModel() {
        fieldModel.clear()
        var common = [0, 2, 3, 4, 7, 11, 12, 13, 37, 39, 41, 42, 49]
        for (var i = 0; i < common.length; ++i) {
            var def = findFieldDef(common[i])
            if (def) {
                fieldModel.append({
                    fieldId: def.id,
                    desc: def.desc,
                    type: def.type,
                    value: "",
                    showHex: false
                })
            }
        }
    }

    function decodePayload() {
        lastError = ""
        if (bufferEncoding.currentIndex === 1 && hasNonAscii(decodeInput.text)) {
            lastError = "Text mode does not support non-ASCII characters. Switch to Hex."
            return
        }
        var response = parseJsonSafe(backend.decodeBuffer(
                                         activePackager,
                                         decodeInput.text,
                                         bufferEncoding.currentIndex === 0,
                                         headerEnabled.checked || headerAuto.checked,
                                         headerAuto.checked ? "auto" : headerMode.currentText.toLowerCase(),
                                         headerSize.value))
        if (!response.ok) {
            lastError = response.error
            return
        }
        fieldModel.clear()
        for (var i = 0; i < response.fields.length; ++i) {
            var f = response.fields[i]
            var fieldValue = f.value || ""
            if (f.id === 35) {
                fieldValue = fieldValue.split("D").join("=")
            }
            fieldModel.append({
                fieldId: f.id,
                desc: f.desc || "",
                type: f.type || "",
                value: fieldValue,
                showHex: false
            })
        }
        if (headerAuto.checked) {
            headerEnabled.checked = response.headerDetected === true
            if (response.headerMode === "binary") {
                headerMode.currentIndex = 1
            } else {
                headerMode.currentIndex = 0
            }
            if (response.headerSize > 0) {
                headerSize.value = response.headerSize
            }
        }
    }

    function encodePayload() {
        lastError = ""
        if (bufferEncoding.currentIndex === 1 && fieldsContainNonAscii()) {
            lastError = "Text mode does not support non-ASCII characters. Switch to Hex."
            return
        }
        var payload = []
        for (var i = 0; i < fieldModel.count; ++i) {
            var entry = fieldModel.get(i)
            var valueText = entry.value
            if (entry.showHex && !isBinaryField(entry.fieldId)) {
                var converted = parseJsonSafe(backend.hexToUtf8(entry.value))
                if (!converted.ok) {
                    lastError = converted.error || "Invalid hex input."
                    return
                }
                valueText = converted.text
            }
            if (entry.fieldId === 35) {
                valueText = valueText.split("D").join("=")
            }
            payload.push({ id: entry.fieldId, value: valueText })
        }
        var response = parseJsonSafe(backend.encodeBuffer(
                                         activePackager,
                                         JSON.stringify(payload),
                                         bufferEncoding.currentIndex === 0,
                                         false,
                                         false,
                                         headerEnabled.checked,
                                         headerMode.currentText.toLowerCase(),
                                         headerSize.value))
        if (!response.ok) {
            lastError = response.error
            if (response.error.indexOf("binary length mismatch") >= 0) {
                binaryMismatchDialog.open()
            } else if (response.error.indexOf("expects numeric value") >= 0) {
                numericMismatchDialog.open()
            }
            return
        }
        decodeInput.text = response.raw || ""
        decodePayload()
    }

    function encodePayloadWithPadding() {
        lastError = ""
        if (bufferEncoding.currentIndex === 1 && fieldsContainNonAscii()) {
            lastError = "Text mode does not support non-ASCII characters. Switch to Hex."
            return
        }
        var payload = []
        for (var i = 0; i < fieldModel.count; ++i) {
            var entry = fieldModel.get(i)
            var valueText = entry.value
            if (entry.showHex && !isBinaryField(entry.fieldId)) {
                var converted = parseJsonSafe(backend.hexToUtf8(entry.value))
                if (!converted.ok) {
                    lastError = converted.error || "Invalid hex input."
                    return
                }
                valueText = converted.text
            }
            if (entry.fieldId === 35) {
                valueText = valueText.split("D").join("=")
            }
            payload.push({ id: entry.fieldId, value: valueText })
        }
        var response = parseJsonSafe(backend.encodeBuffer(
                                         activePackager,
                                         JSON.stringify(payload),
                                         bufferEncoding.currentIndex === 0,
                                         true,
                                         false,
                                         headerEnabled.checked,
                                         headerMode.currentText.toLowerCase(),
                                         headerSize.value))
        if (!response.ok) {
            lastError = response.error
            return
        }
        decodeInput.text = response.raw || ""
        decodePayload()
    }

    function encodePayloadWithNumericSanitize() {
        lastError = ""
        if (bufferEncoding.currentIndex === 1 && fieldsContainNonAscii()) {
            lastError = "Text mode does not support non-ASCII characters. Switch to Hex."
            return
        }
        var payload = []
        for (var i = 0; i < fieldModel.count; ++i) {
            var entry = fieldModel.get(i)
            var valueText = entry.value
            if (entry.showHex && !isBinaryField(entry.fieldId)) {
                var converted = parseJsonSafe(backend.hexToUtf8(entry.value))
                if (!converted.ok) {
                    lastError = converted.error || "Invalid hex input."
                    return
                }
                valueText = converted.text
            }
            if (entry.fieldId === 35) {
                valueText = valueText.split("D").join("=")
            }
            payload.push({ id: entry.fieldId, value: valueText })
        }
        var response = parseJsonSafe(backend.encodeBuffer(
                                         activePackager,
                                         JSON.stringify(payload),
                                         bufferEncoding.currentIndex === 0,
                                         false,
                                         true,
                                         headerEnabled.checked,
                                         headerMode.currentText.toLowerCase(),
                                         headerSize.value))
        if (!response.ok) {
            lastError = response.error
            return
        }
        decodeInput.text = response.raw || ""
        decodePayload()
    }

    function addFieldById(idValue) {
        if (!idValue) {
            return
        }
        var idNumber = parseInt(idValue)
        if (isNaN(idNumber)) {
            lastError = "Field id must be numeric."
            return
        }
        for (var i = 0; i < fieldModel.count; ++i) {
            if (fieldModel.get(i).fieldId === idNumber) {
                return
            }
        }
        var def = findFieldDef(idNumber)
        var insertIndex = fieldModel.count
        for (var j = 0; j < fieldModel.count; ++j) {
            if (fieldModel.get(j).fieldId > idNumber) {
                insertIndex = j
                break
            }
        }
        fieldModel.insert(insertIndex, {
            fieldId: idNumber,
            desc: def ? def.desc : "Custom field",
            type: def ? def.type : "Unknown",
            value: "",
            showHex: false
        })
    }

    function buildFieldPayload(excludeFieldId) {
        var payload = []
        for (var i = 0; i < fieldModel.count; ++i) {
            var entry = fieldModel.get(i)
            if (excludeFieldId >= 0 && entry.fieldId === excludeFieldId) {
                continue
            }
            var valueText = entry.value
            if (entry.showHex && !isBinaryField(entry.fieldId)) {
                var converted = parseJsonSafe(backend.hexToUtf8(entry.value))
                if (!converted.ok) {
                    lastError = converted.error || "Invalid hex input."
                    return null
                }
                valueText = converted.text
            }
            if (entry.fieldId === 35) {
                valueText = valueText.split("D").join("=")
            }
            payload.push({ id: entry.fieldId, value: valueText })
        }
        return payload
    }

    function calculateMac() {
        lastError = ""
        macVerifyStatus = ""
        if (!packagerMacSupported) {
            lastError = "Current packager has no configured MAC metadata."
            return
        }
        var payload = buildFieldPayload(macFieldId.value)
        if (!payload) {
            return
        }
        var response = parseJsonSafe(backend.calculateMacForFields(
                                         activePackager,
                                         JSON.stringify(payload),
                                         macFieldId.value,
                                         macKey.text,
                                         macIncludeHeader.checked,
                                         headerMode.currentText.toLowerCase(),
                                         headerSize.value,
                                         macPadding.paddingModeValue))
        if (!response.ok) {
            lastError = response.error
            return
        }
        macResultHex = response.macHex || ""
    }

    function verifyMac() {
        lastError = ""
        var payload = buildFieldPayload(-1)
        if (!payload) {
            return
        }
        var response = parseJsonSafe(backend.verifyMacForFields(
                                         activePackager,
                                         JSON.stringify(payload),
                                         macFieldId.value,
                                         macKey.text,
                                         macIncludeHeader.checked,
                                         headerMode.currentText.toLowerCase(),
                                         headerSize.value,
                                         macPadding.paddingModeValue))
        if (!response.ok) {
            lastError = response.error
            macVerifyStatus = ""
            return
        }
        macResultHex = response.expectedMacHex || macResultHex
        macVerifyStatus = response.match ? "Match" : "Mismatch"
    }

    function applyMacToField() {
        if (!macResultHex.length) {
            lastError = "Calculate a MAC first."
            return
        }
        var idx = fieldIndexById(macFieldId.value)
        if (idx >= 0) {
            fieldModel.set(idx, { "value": macResultHex, "showHex": false })
            return
        }

        var def = findFieldDef(macFieldId.value)
        var insertIndex = fieldModel.count
        for (var i = 0; i < fieldModel.count; ++i) {
            if (fieldModel.get(i).fieldId > macFieldId.value) {
                insertIndex = i
                break
            }
        }
        fieldModel.insert(insertIndex, {
            fieldId: macFieldId.value,
            desc: def ? def.desc : "MAC field",
            type: def ? def.type : "Binary",
            value: macResultHex,
            showHex: false
        })
    }

    function runCrypto(operation) {
        lastError = ""
        var response = parseJsonSafe(backend.transformCrypto(
                                         cryptoAlgorithm.currentText,
                                         operation,
                                         cryptoInput.text,
                                         cryptoInputMode.currentIndex === 1,
                                         cryptoKey.text,
                                         cryptoIv.text,
                                         cryptoPadding.checked))
        if (!response.ok) {
            lastError = response.error
            return
        }
        cryptoOutput.text = cryptoOutputMode.currentIndex === 0 ? (response.text || "") : (response.rawHex || "")
    }

    function loadTlvField() {
        lastError = ""
        var idx = fieldIndexById(tlvFieldId.value)
        if (idx < 0) {
            lastError = "Field " + tlvFieldId.value + " is not present."
            return
        }
        tlvInput.text = fieldModel.get(idx).value || ""
    }

    function parseTlvInput() {
        lastError = ""
        var response = parseJsonSafe(backend.parseTlv(tlvInput.text, tlvInputMode.currentIndex === 0))
        if (!response.ok) {
            lastError = response.error
            return
        }
        tlvTreeText = response.treeText || ""
        tlvInlineText = response.inlineText || ""
    }

    function saveBufferToPath(path) {
        lastError = ""
        var payload = []
        for (var i = 0; i < fieldModel.count; ++i) {
            var entry = fieldModel.get(i)
            payload.push({ id: entry.fieldId, value: entry.value })
        }
        var response = parseJsonSafe(backend.saveBufferFile(
                                         path,
                                         activePackager,
                                         JSON.stringify(payload),
                                         decodeInput.text,
                                         bufferEncoding.currentIndex === 0,
                                         headerAuto.checked,
                                         headerEnabled.checked,
                                         headerMode.currentText.toLowerCase(),
                                         headerSize.value))
        if (!response.ok) {
            lastError = response.error
            return
        }
        addBufferEntry(path)
        lastError = ""
    }

    function loadBufferFromPath(path) {
        lastError = ""
        var response = parseJsonSafe(backend.loadBufferFile(path))
        if (!response.ok) {
            lastError = response.error
            return
        }
        var buf = response.buffer
        if (buf.packager) {
            activePackager = buf.packager
            var idx = packagerList.indexOf(activePackager)
            if (idx >= 0) {
                packagerCombo.currentIndex = idx
                loadPackagerFields()
            }
        }
        if (buf.lengthHeader) {
            headerEnabled.checked = buf.lengthHeader.enabled
            headerAuto.checked = buf.lengthHeader.auto || buf.lengthHeader.mode === "auto"
            if (buf.lengthHeader.mode === "binary") {
                headerMode.currentIndex = 1
            } else {
                headerMode.currentIndex = 0
            }
            headerSize.value = buf.lengthHeader.size || headerSize.value
        }
        if (buf.raw) {
            decodeInput.text = buf.raw
            bufferEncoding.currentIndex = buf.rawFormat === "hex" ? 0 : 1
        }
        if (buf.fields) {
            fieldModel.clear()
            for (var i = 0; i < buf.fields.length; ++i) {
                var field = buf.fields[i]
                var def = findFieldDef(field.id)
                fieldModel.append({
                    fieldId: field.id,
                    desc: def ? def.desc : "Custom field",
                    type: def ? def.type : "Unknown",
                    value: field.value || "",
                    showHex: false
                })
            }
        }
        addBufferEntry(path)
        currentBufferPath = path
        lastError = ""
    }

    Component.onCompleted: {
        packagerPathValue = backend.defaultPackagerPath()
        loadPackagers(packagerPathValue)
        lastEncodingIndex = bufferEncoding.currentIndex
        updateCursorStatus()
        introAnim.start()
    }

    Dialog {
        id: addFieldDialog
        title: "Add field"
        modal: true
        focus: true
        width: 320
        standardButtons: Dialog.Ok | Dialog.Cancel
        onAccepted: {
            addFieldById(addFieldInput.text)
            addFieldInput.text = ""
        }
        onOpened: {
            addFieldInput.text = ""
            addFieldInput.forceActiveFocus()
            x = (root.width - width) / 2
            y = (root.height - height) / 2
        }
        contentItem: ColumnLayout {
            spacing: 8
            Label {
                text: "Field id"
                font.pixelSize: 12
                color: muted
            }
            TextField {
                id: addFieldInput
                placeholderText: "e.g. 55"
                inputMethodHints: Qt.ImhDigitsOnly
            }
        }
    }

    Dialog {
        id: binaryMismatchDialog
        title: "Binary length mismatch"
        modal: true
        width: 360
        standardButtons: Dialog.Yes | Dialog.No
        onAccepted: encodePayloadWithPadding()
        onOpened: {
            x = (root.width - width) / 2
            y = (root.height - height) / 2
        }
        contentItem: ColumnLayout {
            spacing: 8
            Label {
                text: "A binary field length does not match its packager size."
                font.pixelSize: 12
                color: ink
            }
            Label {
                text: "Build anyway and pad missing bytes with zeros?"
                font.pixelSize: 11
                color: muted
            }
        }
    }

    Dialog {
        id: numericMismatchDialog
        title: "Non-numeric characters"
        modal: true
        width: 360
        standardButtons: Dialog.Yes | Dialog.No
        onAccepted: encodePayloadWithNumericSanitize()
        onOpened: {
            x = (root.width - width) / 2
            y = (root.height - height) / 2
        }
        contentItem: ColumnLayout {
            spacing: 8
            Label {
                text: "A numeric field contains non-digit characters."
                font.pixelSize: 12
                color: ink
            }
            Label {
                text: "Build anyway and strip non-digits?"
                font.pixelSize: 11
                color: muted
            }
        }
    }

    NumberAnimation {
        id: introAnim
        target: root
        property: "intro"
        from: 0
        to: 1
        duration: 650
        easing.type: Easing.OutCubic
    }

    palette {
        window: backgroundBottom
        base: cardAlt
        text: ink
        button: card
        buttonText: ink
        highlight: accent
        highlightedText: "#0B0F14"
    }

    background: Rectangle {
        anchors.fill: parent
        gradient: Gradient {
            GradientStop { position: 0.0; color: backgroundTop }
            GradientStop { position: 1.0; color: backgroundBottom }
        }
        Rectangle {
            width: 520
            height: 520
            radius: 260
            color: "#1A2A33"
            opacity: 0.45
            anchors.right: parent.right
            anchors.top: parent.top
            anchors.rightMargin: -120
            anchors.topMargin: -140
        }
        Rectangle {
            width: 420
            height: 420
            radius: 210
            color: "#1B3F4F"
            opacity: 0.32
            anchors.left: parent.left
            anchors.bottom: parent.bottom
            anchors.leftMargin: -140
            anchors.bottomMargin: -120
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.leftMargin: 24
        anchors.rightMargin: 24
        anchors.bottomMargin: 24
        anchors.topMargin: 12
        spacing: 12

        Item { Layout.fillWidth: true; height: 0 }

        RowLayout {
            Layout.fillWidth: true
            Layout.fillHeight: true
            spacing: 12

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 18
                color: card
                border.color: border
                border.width: 1
                opacity: 0.2 + 0.8 * intro
                y: -8 + 8 * intro

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 12
                    spacing: 8

                    RowLayout {
                        Layout.fillWidth: true
                        Layout.fillHeight: false
                        Layout.preferredHeight: 150
                        Layout.maximumHeight: 170
                        Layout.minimumHeight: 140
                        spacing: 12

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            radius: 12
                            color: cardAlt
                            border.color: border
                            ColumnLayout {
                                anchors.fill: parent
                                anchors.margins: 10
                                spacing: 6
                                RowLayout {
                                    Layout.fillWidth: true
                                    spacing: 8
                                    Label {
                                        text: "Buffer"
                                        font.pixelSize: 13
                                        font.weight: Font.DemiBold
                                        color: ink
                                        Layout.fillWidth: true
                                    }
                                    ComboBox {
                                        id: bufferEncoding
                                        model: ["Hex", "Text"]
                                        currentIndex: 0
                                        Layout.preferredWidth: 110
                                        Layout.preferredHeight: 28
                                        padding: 8
                                        background: Rectangle {
                                            radius: 8
                                            color: bufferEncoding.hovered ? "#223140" : "#1B2530"
                                            border.color: border
                                            border.width: 1
                                        }
                                        contentItem: Label {
                                            text: bufferEncoding.displayText
                                            font.pixelSize: 12
                                            color: ink
                                            verticalAlignment: Text.AlignVCenter
                                            horizontalAlignment: Text.AlignLeft
                                            elide: Text.ElideRight
                                        }
                                        indicator: Rectangle {
                                            width: 10
                                            height: 10
                                            radius: 2
                                            color: "transparent"
                                            border.color: muted
                                            border.width: 1
                                            anchors.verticalCenter: parent.verticalCenter
                                            anchors.right: parent.right
                                            anchors.rightMargin: 8
                                        }
                                        onCurrentIndexChanged: {
                                            if (encodingGuard) {
                                                return
                                            }
                                            if (currentIndex === lastEncodingIndex) {
                                                return
                                            }
                                            if (currentIndex === 1) {
                                                var converted = parseJsonSafe(backend.hexToUtf8(decodeInput.text))
                                                if (!converted.ok) {
                                                    lastError = converted.error || "Invalid hex input."
                                                    encodingGuard = true
                                                    currentIndex = lastEncodingIndex
                                                    encodingGuard = false
                                                    return
                                                }
                                                if (fieldsContainNonAscii()) {
                                                    lastError = "Text mode does not support non-ASCII characters in fields. Switch to Hex."
                                                    encodingGuard = true
                                                    currentIndex = lastEncodingIndex
                                                    encodingGuard = false
                                                    return
                                                }
                                                if (hasNonAscii(converted.text)) {
                                                    lastError = "Text mode does not support non-ASCII characters. Switch to Hex."
                                                    encodingGuard = true
                                                    currentIndex = lastEncodingIndex
                                                    encodingGuard = false
                                                    return
                                                }
                                                decodeInput.text = converted.text
                                            } else {
                                                decodeInput.text = backend.utf8ToHex(decodeInput.text)
                                            }
                                            lastEncodingIndex = currentIndex
                                        }
                                    }
                                    AppButton {
                                        text: "Decode"
                                        onClicked: decodePayload()
                                    }
                                    AppButton {
                                        text: "Build"
                                        onClicked: encodePayload()
                                    }
                                    AppButton {
                                        text: "Add length"
                                        onClicked: addLengthHeaderIfMissing()
                                    }
                                }
                                TextArea {
                                    id: decodeInput
                                    Layout.fillWidth: true
                                    Layout.fillHeight: true
                                    placeholderText: "Paste or build an ISO 8583 buffer here..."
                                    color: ink
                                    font.pixelSize: 14
                                    placeholderTextColor: muted
                                    wrapMode: TextArea.Wrap
                                    selectByMouse: true
                                    background: Rectangle {
                                        radius: 8
                                        color: "#121922"
                                        border.color: border
                                        border.width: 1
                                    }
                                    onCursorPositionChanged: updateCursorStatus()
                                    onSelectionStartChanged: updateCursorStatus()
                                    onSelectionEndChanged: updateCursorStatus()
                                    onTextChanged: updateCursorStatus()
                                    onActiveFocusChanged: {
                                        if (activeFocus) {
                                            activeEditor = "buffer"
                                            updateCursorStatus()
                                        }
                                    }
                                    TapHandler {
                                        acceptedButtons: Qt.LeftButton
                                        onDoubleTapped: decodePayload()
                                    }
                                }
                            }
                        }
                    }

                    RowLayout {
                        Layout.fillWidth: true
                        spacing: 8
                        Label {
                            text: "Fields"
                            font.pixelSize: 13
                            font.weight: Font.DemiBold
                            color: ink
                            Layout.fillWidth: true
                        }
                        AppButton {
                            text: "Add"
                            onClicked: {
                                addFieldDialog.open()
                            }
                        }
                        AppButton {
                            text: "Clear"
                            onClicked: fieldModel.clear()
                        }
                        AppButton {
                            text: "Reset"
                            onClicked: rebuildFieldModel()
                        }
                    }

                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        Layout.minimumHeight: 240
                        radius: 12
                        color: cardAlt
                        border.color: border

                        GridView {
                            anchors.fill: parent
                            anchors.margins: 4
                            model: fieldModel
                            clip: true
                            cellWidth: (width - 8) / 2
                            cellHeight: fieldRowHeight + fieldRowSpacing
                            ScrollBar.vertical: ScrollBar { }

                            delegate: Rectangle {
                                width: GridView.view.cellWidth - 6
                                height: fieldRowHeight
                                radius: 10
                                color: index % 2 === 0 ? "#18222D" : "#1C2733"
                                border.color: border
                                RowLayout {
                                    anchors.fill: parent
                                    anchors.margins: 4
                                    spacing: 3
                                    Rectangle {
                                        width: 36
                                        height: 22
                                        radius: 10
                                        color: "#1A2C2B"
                                        Label {
                                            anchors.centerIn: parent
                                            text: "F" + fieldId
                                            font.pixelSize: 10
                                            font.weight: Font.DemiBold
                                            color: "#7BEAD0"
                                        }
                                    }
                                    ColumnLayout {
                                        Layout.fillWidth: true
                                        Layout.alignment: Qt.AlignVCenter
                                        spacing: 0
                                        Label {
                                            text: desc.length ? desc : "Field " + fieldId
                                            font.pixelSize: 12
                                            color: ink
                                            elide: Text.ElideRight
                                            horizontalAlignment: Text.AlignLeft
                                            Layout.fillWidth: true
                                        }
                                        Label {
                                            text: type
                                            font.pixelSize: 10
                                            color: muted
                                            horizontalAlignment: Text.AlignLeft
                                            Layout.fillWidth: true
                                        }
                                    }
                                    TextField {
                                        Layout.preferredWidth: fieldValueWidth
                                        Layout.preferredHeight: 22
                                        Layout.alignment: Qt.AlignVCenter | Qt.AlignRight
                                        text: value
                                        font.pixelSize: 14
                                        color: ink
                                        placeholderTextColor: muted
                                        horizontalAlignment: TextInput.AlignLeft
                                        placeholderText: showHex ? "Hex" : "Value"
                                        selectByMouse: true
                                        background: Rectangle {
                                            radius: 6
                                            color: "#111821"
                                            border.color: hasNonAscii(value) && !showHex ? "#E9A645"
                                                : (hasEdgeSpace(value) ? "#4DD4C6" : border)
                                        }
                                        onTextChanged: fieldModel.set(index, { "value": text, "showHex": showHex })
                                        onCursorPositionChanged: updateCursorStatusFrom(text, cursorPosition, selectionStart, selectionEnd, false)
                                        onSelectionStartChanged: updateCursorStatusFrom(text, cursorPosition, selectionStart, selectionEnd, false)
                                        onSelectionEndChanged: updateCursorStatusFrom(text, cursorPosition, selectionStart, selectionEnd, false)
                                        onActiveFocusChanged: {
                                            if (activeFocus) {
                                                activeEditor = "field"
                                                updateCursorStatusFrom(text, cursorPosition, selectionStart, selectionEnd, false)
                                            }
                                        }
                                        ToolTip.visible: spaceHover.containsMouse && hasEdgeSpace(value)
                                        ToolTip.text: "Leading or trailing spaces"
                                        MouseArea {
                                            id: spaceHover
                                            anchors.fill: parent
                                            hoverEnabled: true
                                            acceptedButtons: Qt.NoButton
                                            cursorShape: Qt.IBeamCursor
                                        }
                                    }
                                    Rectangle {
                                        width: fieldHexWidth
                                        height: 22
                                        radius: 6
                                        color: showHex ? "#1E3A3A" : "#19222C"
                                        border.color: showHex ? "#4DD4C6" : border
                                        opacity: isBinaryField(fieldId) ? 0.4 : 1
                                        Label {
                                            anchors.centerIn: parent
                                            text: "Hx"
                                            font.pixelSize: 9
                                            color: showHex ? "#7BEAD0" : muted
                                        }
                                        MouseArea {
                                            anchors.fill: parent
                                            enabled: !isBinaryField(fieldId)
                                            onClicked: toggleFieldHex(index)
                                        }
                                    }
                                    Rectangle {
                                        width: fieldActionWidth
                                        height: 22
                                        radius: 6
                                        color: "#19222C"
                                        border.color: border
                                        Label {
                                            anchors.centerIn: parent
                                            text: "x"
                                            font.pixelSize: 12
                                            color: muted
                                        }
                                        MouseArea {
                                            anchors.fill: parent
                                            onClicked: {
                                                fieldModel.remove(index)
                                                encodePayload()
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    Rectangle {
        id: settingsPanel
        width: settingsWidth
        height: 430
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: settingsButton.x
        y: settingsOpen ? (settingsButton.y - height - 10) : (parent.height + 24)
        z: 10
        opacity: 0.15 + 0.85 * intro

        Behavior on y {
            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 12

            Label {
                text: "Packagers"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            Rectangle {
                Layout.fillWidth: true
                height: 36
                radius: 10
                color: "#0F1318"
                border.color: border
                RowLayout {
                    anchors.fill: parent
                    anchors.margins: 6
                    spacing: 6
                    Label {
                        text: packagerPathValue.length ? packagerPathValue : "Select packager XML"
                        font.pixelSize: 11
                        color: muted
                        elide: Text.ElideMiddle
                        Layout.fillWidth: true
                    }
                    AppButton {
                        text: "Browse"
                        Layout.alignment: Qt.AlignVCenter
                        Layout.preferredHeight: 24
                        padding: 8
                        onClicked: {
                            var path = backend.choosePackagerFile()
                            if (path && path.length) {
                                packagerPathValue = path
                                loadPackagers(packagerPathValue)
                            }
                        }
                    }
                }
            }

            ComboBox {
                id: packagerCombo
                model: packagerList
                Layout.fillWidth: true
                Layout.preferredHeight: 30
                padding: 8
                background: Rectangle {
                    radius: 8
                    color: packagerCombo.hovered ? "#223140" : "#1B2530"
                    border.color: border
                    border.width: 1
                }
                contentItem: Label {
                    text: packagerCombo.displayText
                    font.pixelSize: 12
                    color: ink
                    verticalAlignment: Text.AlignVCenter
                    horizontalAlignment: Text.AlignLeft
                    elide: Text.ElideRight
                }
                indicator: Rectangle {
                    width: 10
                    height: 10
                    radius: 2
                    color: "transparent"
                    border.color: muted
                    border.width: 1
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    anchors.rightMargin: 8
                }
                onActivated: {
                    activePackager = currentText
                    loadPackagerFields()
                }
            }

            Rectangle {
                height: 1
                color: border
                Layout.fillWidth: true
            }

            Label {
                text: "Buffers"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                AppButton {
                    text: "Open"
                    Layout.fillWidth: true
                    onClicked: openBufferFile()
                }
                AppButton {
                    text: "Save"
                    Layout.fillWidth: true
                    onClicked: saveCurrentBuffer()
                }
                AppButton {
                    text: "Save As"
                    Layout.fillWidth: true
                    onClicked: saveBufferAs()
                }
            }

            ComboBox {
                id: bufferSwitcher
                model: bufferModel
                textRole: "name"
                Layout.fillWidth: true
                Layout.preferredHeight: 30
                enabled: bufferModel.count > 0
                currentIndex: selectedBufferIndex
                padding: 8
                background: Rectangle {
                    radius: 8
                    color: bufferSwitcher.hovered ? "#223140" : "#1B2530"
                    border.color: border
                    border.width: 1
                }
                contentItem: Label {
                    text: bufferSwitcher.displayText
                    font.pixelSize: 12
                    color: ink
                    verticalAlignment: Text.AlignVCenter
                    horizontalAlignment: Text.AlignLeft
                    elide: Text.ElideRight
                }
                indicator: Rectangle {
                    width: 10
                    height: 10
                    radius: 2
                    color: "transparent"
                    border.color: muted
                    border.width: 1
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    anchors.rightMargin: 8
                }
                onActivated: selectBufferAt(currentIndex)
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.preferredHeight: 34
                radius: 8
                color: "#0F1318"
                border.color: border
                Label {
                    anchors.fill: parent
                    anchors.leftMargin: 10
                    anchors.rightMargin: 10
                    verticalAlignment: Text.AlignVCenter
                    text: currentBufferPath.length ? currentBufferPath : "No buffer file selected"
                    font.pixelSize: 11
                    color: currentBufferPath.length ? ink : muted
                    elide: Text.ElideMiddle
                }
            }

            Rectangle {
                height: 1
                color: border
                Layout.fillWidth: true
            }

            Label {
                text: "Message length"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                CheckBox {
                    id: headerAuto
                    text: "Auto-detect decode"
                    checked: true
                    Layout.fillWidth: true
                }
                CheckBox {
                    id: headerEnabled
                    text: "Include on build"
                    checked: false
                    Layout.fillWidth: true
                }
            }

            RowLayout {
                spacing: 8
                ComboBox {
                    id: headerMode
                    model: ["ASCII", "Binary"]
                    currentIndex: 0
                    enabled: headerEnabled.checked
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                    padding: 8
                    background: Rectangle {
                        radius: 8
                        color: headerMode.hovered ? "#223140" : "#1B2530"
                        border.color: border
                        border.width: 1
                    }
                    contentItem: Label {
                        text: headerMode.displayText
                        font.pixelSize: 12
                        color: ink
                        verticalAlignment: Text.AlignVCenter
                        horizontalAlignment: Text.AlignLeft
                        elide: Text.ElideRight
                    }
                    indicator: Rectangle {
                        width: 10
                        height: 10
                        radius: 2
                        color: "transparent"
                        border.color: muted
                        border.width: 1
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.right: parent.right
                        anchors.rightMargin: 8
                    }
                }
                SpinBox {
                    id: headerSize
                    from: 1
                    to: 8
                    value: 4
                    enabled: headerEnabled.checked || headerAuto.checked
                }
            }

        }
    }

    Rectangle {
        id: macPanel
        width: 360
        height: 360
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: macButton.x
        y: macOpen ? (macButton.y - height - 10) : (parent.height + 24)
        z: 10
        opacity: 0.15 + 0.85 * intro

        Behavior on y {
            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Label {
                text: "MAC"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            Label {
                text: packagerMacSupported
                      ? ("Method " + (packagerMacMethod.length ? packagerMacMethod : "n/a") + "  Size " + packagerMacSize)
                      : "No MAC metadata in current packager"
                font.pixelSize: 11
                color: muted
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                SpinBox {
                    id: macFieldId
                    from: 0
                    to: 128
                    value: 64
                    editable: true
                    enabled: packagerMacSupported
                    Layout.preferredWidth: 90
                }
                ComboBox {
                    id: macPadding
                    model: ["ISO9797 M1", "ISO9797 M2"]
                    property string paddingModeValue: currentIndex === 1 ? "m2" : "m1"
                    currentIndex: 0
                    enabled: packagerMacSupported
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                    padding: 8
                    background: Rectangle {
                        radius: 8
                        color: macPadding.hovered ? "#223140" : "#1B2530"
                        border.color: border
                        border.width: 1
                    }
                    contentItem: Label {
                        text: macPadding.displayText
                        font.pixelSize: 12
                        color: ink
                        verticalAlignment: Text.AlignVCenter
                        horizontalAlignment: Text.AlignLeft
                        elide: Text.ElideRight
                    }
                    indicator: Rectangle {
                        width: 10
                        height: 10
                        radius: 2
                        color: "transparent"
                        border.color: muted
                        border.width: 1
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.right: parent.right
                        anchors.rightMargin: 8
                    }
                }
            }

            TextField {
                id: macKey
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                enabled: packagerMacSupported
                placeholderText: "MAC key hex (8, 16, or 24 bytes)"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                }
            }

            CheckBox {
                id: macIncludeHeader
                text: "Include length header in MAC input"
                checked: false
                enabled: packagerMacSupported
                Layout.fillWidth: true
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                AppButton {
                    text: "Calc"
                    enabled: packagerMacSupported
                    Layout.fillWidth: true
                    onClicked: calculateMac()
                }
                AppButton {
                    text: "Verify"
                    enabled: packagerMacSupported
                    Layout.fillWidth: true
                    onClicked: verifyMac()
                }
                AppButton {
                    text: "Apply"
                    enabled: packagerMacSupported
                    Layout.fillWidth: true
                    onClicked: applyMacToField()
                }
            }

            TextField {
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                readOnly: true
                text: macResultHex
                placeholderText: "Calculated MAC"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                }
            }

            Label {
                text: macVerifyStatus
                font.pixelSize: 11
                color: macVerifyStatus === "Match" ? "#63E6BE"
                      : (macVerifyStatus === "Mismatch" ? "#E18A74" : muted)
                Layout.fillWidth: true
            }
        }
    }

    Rectangle {
        id: cryptoPanel
        width: 420
        height: 460
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: cryptoButton.x
        y: cryptoOpen ? (cryptoButton.y - height - 10) : (parent.height + 24)
        z: 10
        opacity: 0.15 + 0.85 * intro

        Behavior on y {
            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Label {
                text: "Crypto"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            ComboBox {
                id: cryptoAlgorithm
                model: ["DES-ECB", "DES-CBC", "3DES-ECB", "3DES-CBC", "AES-128-ECB", "AES-128-CBC", "AES-256-ECB", "AES-256-CBC"]
                Layout.fillWidth: true
                Layout.preferredHeight: 30
                padding: 8
                background: Rectangle {
                    radius: 8
                    color: cryptoAlgorithm.hovered ? "#223140" : "#1B2530"
                    border.color: border
                    border.width: 1
                }
                contentItem: Label {
                    text: cryptoAlgorithm.displayText
                    font.pixelSize: 12
                    color: ink
                    verticalAlignment: Text.AlignVCenter
                    horizontalAlignment: Text.AlignLeft
                    elide: Text.ElideRight
                }
                indicator: Rectangle {
                    width: 10
                    height: 10
                    radius: 2
                    color: "transparent"
                    border.color: muted
                    border.width: 1
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.right: parent.right
                    anchors.rightMargin: 8
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                ComboBox {
                    id: cryptoInputMode
                    model: ["Text In", "Hex In"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
                ComboBox {
                    id: cryptoOutputMode
                    model: ["Text Out", "Hex Out"]
                    currentIndex: 1
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
            }

            TextField {
                id: cryptoKey
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: "Key hex"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                }
            }

            TextField {
                id: cryptoIv
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: "IV hex (CBC only)"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                }
            }

            CheckBox {
                id: cryptoPadding
                text: "Use block padding"
                checked: true
                Layout.fillWidth: true
            }

            TextArea {
                id: cryptoInput
                Layout.fillWidth: true
                Layout.preferredHeight: 110
                placeholderText: "Input text or hex"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                wrapMode: TextArea.Wrap
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                    border.width: 1
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                AppButton {
                    text: "Encrypt"
                    Layout.fillWidth: true
                    onClicked: runCrypto("encrypt")
                }
                AppButton {
                    text: "Decrypt"
                    Layout.fillWidth: true
                    onClicked: runCrypto("decrypt")
                }
            }

            TextArea {
                id: cryptoOutput
                Layout.fillWidth: true
                Layout.fillHeight: true
                readOnly: true
                placeholderText: "Output"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                wrapMode: TextArea.Wrap
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                    border.width: 1
                }
            }
        }
    }

    Rectangle {
        id: tlvPanel
        width: 460
        height: 520
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: tlvButton.x
        y: tlvOpen ? (tlvButton.y - height - 10) : (parent.height + 24)
        z: 10
        opacity: 0.15 + 0.85 * intro

        Behavior on y {
            NumberAnimation { duration: 220; easing.type: Easing.OutCubic }
        }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Label {
                text: "TLV"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                SpinBox {
                    id: tlvFieldId
                    from: 0
                    to: 128
                    value: 48
                    editable: true
                    Layout.preferredWidth: 90
                }
                ComboBox {
                    id: tlvInputMode
                    model: ["Hex In", "Text In"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
                AppButton {
                    text: "Load Field"
                    onClicked: loadTlvField()
                }
                AppButton {
                    text: "Parse"
                    onClicked: parseTlvInput()
                }
            }

            TextArea {
                id: tlvInput
                Layout.fillWidth: true
                Layout.preferredHeight: 96
                placeholderText: "TLV input"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                wrapMode: TextArea.Wrap
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                    border.width: 1
                }
            }

            Label {
                text: "Tree"
                font.pixelSize: 12
                font.weight: Font.DemiBold
                color: ink
            }

            TextArea {
                Layout.fillWidth: true
                Layout.preferredHeight: 150
                readOnly: true
                text: tlvTreeText
                placeholderText: "Parsed TLV tree"
                color: ink
                font.pixelSize: 12
                placeholderTextColor: muted
                wrapMode: TextArea.Wrap
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                    border.width: 1
                }
            }

            Label {
                text: "Flat"
                font.pixelSize: 12
                font.weight: Font.DemiBold
                color: ink
            }

            TextArea {
                Layout.fillWidth: true
                Layout.fillHeight: true
                readOnly: true
                text: tlvInlineText
                placeholderText: "Parsed TLV flat view"
                color: ink
                font.pixelSize: 12
                placeholderTextColor: muted
                wrapMode: TextArea.Wrap
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                    border.width: 1
                }
            }
        }
    }

    Rectangle {
        id: statusBar
        height: 32
        radius: 10
        color: "#0F1318"
        border.color: border
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        anchors.leftMargin: 24
        anchors.rightMargin: 24
        anchors.bottomMargin: 16
        z: 9

        RowLayout {
            anchors.fill: parent
            anchors.margins: 6
            spacing: 6
            Item { Layout.fillWidth: true }
            Label {
                text: "Ln " + cursorLine + " : Col " + cursorCol + " : Pos " + cursorPos + " : Sel " + selectionLen
                font.pixelSize: 11
                color: muted
            }
            Rectangle {
                width: 10
                height: 10
                radius: 5
                color: lastError.length ? "#E76F51" : "#2A9D8F"
            }
                    Label {
                        text: lastError.length ? lastError : "Ready"
                        font.pixelSize: 11
                        color: lastError.length ? "#E18A74" : "#63E6BE"
                        elide: Text.ElideRight
                        horizontalAlignment: Text.AlignRight
                    }
        }
    }


    AppButton {
        id: settingsButton
        text: settingsOpen ? "Settings v" : "Settings >"
        anchors.left: statusBar.left
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("settings")
            settingsOpen = !settingsOpen
            if (settingsOpen) {
                closeToolPanels("settings")
            }
        }
    }

    AppButton {
        id: macButton
        text: macOpen ? "MAC v" : "MAC >"
        anchors.left: settingsButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("mac")
            macOpen = !macOpen
            if (macOpen) {
                closeToolPanels("mac")
            }
        }
    }

    AppButton {
        id: cryptoButton
        text: cryptoOpen ? "Crypto v" : "Crypto >"
        anchors.left: macButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("crypto")
            cryptoOpen = !cryptoOpen
            if (cryptoOpen) {
                closeToolPanels("crypto")
            }
        }
    }

    AppButton {
        id: tlvButton
        text: tlvOpen ? "TLV v" : "TLV >"
        anchors.left: cryptoButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("tlv")
            tlvOpen = !tlvOpen
            if (tlvOpen) {
                closeToolPanels("tlv")
            }
        }
    }
}
