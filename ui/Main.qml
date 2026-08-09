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
    property string tlvOutputHex: ""
    property string iranSystemOutputText: ""
    property string iranSystemOutputMeta: ""
    property real intro: 0
    property string packagerPathValue: ""
    property int selectedBufferIndex: -1
    property string currentBufferPath: ""
    property int lastEncodingIndex: 0
    property bool encodingGuard: false
    property bool settingsOpen: false
    property bool macOpen: false
    property bool pinOpen: false
    property bool cryptoOpen: false
    property bool rsaOpen: false
    property bool tlvOpen: false
    property bool iranSystemOpen: false
    property bool bankingToolsOpen: false
    property bool networkOpen: false
    property bool infoOpen: false
    property string rsaVerifyStatus: ""
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
        pinOpen = exceptName === "pin" ? pinOpen : false
        cryptoOpen = exceptName === "crypto" ? cryptoOpen : false
        rsaOpen = exceptName === "rsa" ? rsaOpen : false
        tlvOpen = exceptName === "tlv" ? tlvOpen : false
        iranSystemOpen = exceptName === "iranSystem" ? iranSystemOpen : false
        bankingToolsOpen = exceptName === "bankingTools" ? bankingToolsOpen : false
        networkOpen = exceptName === "network" ? networkOpen : false
        infoOpen = exceptName === "info" ? infoOpen : false
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

    function runBankingUtility() {
        lastError = ""
        var op = bankingOperation.currentText
        var normalized = op.toLowerCase().split(" ").join("").split("-").join("")
        var secondary = bankingSecondary.text
        if (normalized === "md5" || normalized === "sha1" || normalized === "sha256" || normalized === "sha512") {
            secondary = bankingInputMode.currentIndex === 1 ? "hex" : "text"
        }
        var response = parseJsonSafe(backend.runBankingUtility(op,
                                                                bankingInput.text,
                                                                secondary,
                                                                bankingParameter.value))
        if (!response.ok) {
            lastError = response.error
            return
        }
        bankingOutput.text = response.output || ""
    }

    function sendNetworkRequest() {
        lastError = ""
        networkMeta.text = ""
        var response = parseJsonSafe(backend.sendTcpRequest(
                                         networkHost.text,
                                         networkPort.value,
                                         networkPayload.text,
                                         networkInputMode.currentIndex === 0,
                                         networkFraming.currentText.toLowerCase(),
                                         networkHeaderSize.value,
                                         networkTimeout.value))
        if (!response.ok) {
            lastError = response.error
            return
        }
        networkResponse.text = networkOutputMode.currentIndex === 0
                             ? (response.responseHex || "")
                             : (response.responseText || "")
        networkMeta.text = (response.responseLength || 0) + " bytes in "
                           + (response.elapsedMs || 0) + " ms\nWire: "
                           + (response.responseWireHex || "")
    }

    function applyLegacyFraming() {
        if (!legacyEngineMode.checked) {
            return
        }
        if (activePackager === "HYPERCOM") {
            headerEnabled.checked = true
            headerAuto.checked = true
            headerMode.currentIndex = 1
            headerSize.value = 2
        } else if (activePackager === "DATASET" || activePackager.indexOf("TABLE") === 0 ||
                   activePackager.indexOf("AMNT") === 0 || activePackager.indexOf("STX") === 0 ||
                   activePackager === "STMNT2003" || activePackager === "BIT121") {
            headerEnabled.checked = false
            headerAuto.checked = false
        } else {
            headerEnabled.checked = true
            headerAuto.checked = true
            headerMode.currentIndex = 0
            headerSize.value = activePackager === "SLMLink" ? 7 : 4
        }
    }

    function createPinBlock() {
        lastError = ""
        var response = parseJsonSafe(backend.createPinBlock(pinFormat.currentText,
                                                             pinClearPin.text,
                                                             pinPan.text,
                                                             pinKey.text))
        if (!response.ok) {
            lastError = response.error
            return
        }
        if (response.encrypted) {
            pinEncryptedBlock.text = response.pinBlockHex || ""
        } else {
            pinClearBlock.text = response.pinBlockHex || ""
        }
    }

    function decodePinBlock() {
        lastError = ""
        var sourceBlock = pinFormat.currentIndex === 3 ? pinEncryptedBlock.text : pinClearBlock.text
        var response = parseJsonSafe(backend.decodePinBlock(pinFormat.currentText,
                                                             sourceBlock,
                                                             pinPan.text,
                                                             pinKey.text))
        if (!response.ok) {
            lastError = response.error
            return
        }
        pinClearPin.text = response.pin || ""
    }

    function encryptPinBlock() {
        lastError = ""
        var response = parseJsonSafe(backend.encryptPinBlock(pinClearBlock.text, pinKey.text))
        if (!response.ok) {
            lastError = response.error
            return
        }
        pinEncryptedBlock.text = response.pinBlockHex || ""
    }

    function decryptPinBlock() {
        lastError = ""
        var response = parseJsonSafe(backend.decryptPinBlock(pinEncryptedBlock.text, pinKey.text))
        if (!response.ok) {
            lastError = response.error
            return
        }
        pinClearBlock.text = response.pinBlockHex || ""
    }

    function calculatePinVerification() {
        lastError = ""
        var response
        if (pinTool.currentIndex === 1) {
            response = parseJsonSafe(backend.calculateVisaPvv(pinClearPin.text, pinPan.text,
                                                               pinPvki.text, pinKey.text))
            if (response.ok) pinVerificationResult.text = response.pvv || ""
        } else {
            response = parseJsonSafe(backend.calculateIbm3624Offset(
                                         pinClearPin.text, pinValidationData.text,
                                         pinDecimalization.text, pinKey.text))
            if (response.ok) {
                pinOffset.text = response.offset || ""
                pinVerificationResult.text = "Natural PIN: " + (response.naturalPin || "")
            }
        }
        if (!response.ok) lastError = response.error
    }

    function verifyIbmPin() {
        lastError = ""
        var response = parseJsonSafe(backend.verifyIbm3624Pin(
                                         pinClearPin.text, pinOffset.text,
                                         pinValidationData.text, pinDecimalization.text,
                                         pinKey.text))
        if (!response.ok) {
            lastError = response.error
            return
        }
        pinVerificationResult.text = response.status + " | Natural PIN: " + (response.naturalPin || "")
    }

    function translateAtmPinBlock() {
        lastError = ""
        var response = parseJsonSafe(backend.translateAtmPinBlock(
                                         pinTranslateSourceBlock.text,
                                         pinPan.text,
                                         pinTranslateSourceFormat.currentText,
                                         pinTranslateSourceAlgorithm.currentText,
                                         pinTranslateSourceKey.text,
                                         pinTranslateDestinationFormat.currentText,
                                         pinTranslateDestinationAlgorithm.currentText,
                                         pinTranslateDestinationKey.text))
        if (!response.ok) {
            lastError = response.error
            return
        }
        pinTranslateOutput.text = response.translatedPinBlockHex || ""
    }

    function signRsaSha() {
        lastError = ""
        rsaVerifyStatus = ""
        var response = parseJsonSafe(backend.signRsaShaBase64(
                                         rsaPayload.text,
                                         rsaPrivateKey.text,
                                         rsaDigest.currentText))
        if (!response.ok) {
            lastError = response.error
            return
        }
        rsaSignature.text = response.signatureBase64 || ""
    }

    function verifyRsaSha() {
        lastError = ""
        rsaVerifyStatus = ""
        var response = parseJsonSafe(backend.verifyRsaShaBase64(
                                         rsaPayload.text,
                                         rsaPublicKey.text,
                                         rsaSignature.text,
                                         rsaDigest.currentText))
        if (!response.ok) {
            lastError = response.error
            return
        }
        rsaVerifyStatus = response.match ? "Match" : "Mismatch"
    }

    function encryptRsa() {
        lastError = ""
        var response = parseJsonSafe(backend.encryptRsaBase64(rsaPayload.text,
                                                               rsaPublicKey.text,
                                                               rsaPadding.currentText))
        if (!response.ok) {
            lastError = response.error
            return
        }
        rsaSignature.text = response.ciphertextBase64 || ""
        rsaVerifyStatus = "Encrypted"
    }

    function decryptRsa() {
        lastError = ""
        var response = parseJsonSafe(backend.decryptRsaBase64(rsaSignature.text,
                                                               rsaPrivateKey.text,
                                                               rsaPadding.currentText))
        if (!response.ok) {
            lastError = response.error
            return
        }
        rsaPayload.text = response.plaintext || ""
        rsaVerifyStatus = "Decrypted"
    }

    function loadPinField52() {
        lastError = ""
        var idx = fieldIndexById(52)
        if (idx < 0) {
            lastError = "Field 52 is not present."
            return
        }
        pinEncryptedBlock.text = fieldModel.get(idx).value || ""
    }

    function applyPinField52() {
        lastError = ""
        if (!pinEncryptedBlock.text.length) {
            lastError = "Encrypted PIN block is empty."
            return
        }
        var idx = fieldIndexById(52)
        if (idx >= 0) {
            fieldModel.set(idx, {
                               "fieldId": fieldModel.get(idx).fieldId,
                               "desc": fieldModel.get(idx).desc,
                               "type": fieldModel.get(idx).type,
                               "value": pinEncryptedBlock.text,
                               "showHex": false
                           })
            return
        }

        var def = findFieldDef(52)
        var insertIndex = fieldModel.count
        for (var i = 0; i < fieldModel.count; ++i) {
            if (fieldModel.get(i).fieldId > 52) {
                insertIndex = i
                break
            }
        }
        fieldModel.insert(insertIndex, {
            fieldId: 52,
            desc: def ? def.desc : "PIN DATA",
            type: def ? def.type : "Binary",
            value: pinEncryptedBlock.text,
            showHex: false
        })
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
        tlvOutputHex = response.rawHex || ""
        tlvTreeText = response.treeText || ""
        tlvInlineText = response.inlineText || ""
    }

    function buildTlvInput() {
        lastError = ""
        var response = parseJsonSafe(backend.buildTlv(
                                         tlvTagInput.text,
                                         tlvInput.text,
                                         tlvValueMode.currentIndex === 0,
                                         tlvConstructed.checked))
        if (!response.ok) {
            lastError = response.error
            return
        }
        tlvOutputHex = response.rawHex || ""
        tlvTreeText = response.treeText || ""
        tlvInlineText = response.inlineText || ""
    }

    function convertTlvXml() {
        lastError = ""
        if (tlvMode.currentIndex === 2) {
            var encoded = parseJsonSafe(backend.tlvToXml(tlvInput.text,
                                                          tlvInputMode.currentIndex === 0))
            if (!encoded.ok) {
                lastError = encoded.error
                return
            }
            tlvOutputHex = encoded.rawHex || ""
            tlvInput.text = encoded.xml || ""
            tlvTreeText = "XML is now editable in the input area."
            tlvInlineText = ""
            tlvMode.currentIndex = 3
        } else {
            var decoded = parseJsonSafe(backend.xmlToTlv(tlvInput.text))
            if (!decoded.ok) {
                lastError = decoded.error
                return
            }
            tlvOutputHex = decoded.rawHex || ""
            tlvTreeText = decoded.treeText || ""
            tlvInlineText = ""
        }
    }

    function loadIranSystemField() {
        lastError = ""
        var idx = fieldIndexById(iranSystemFieldId.value)
        if (idx < 0) {
            lastError = "Field " + iranSystemFieldId.value + " is not present."
            return
        }
        iranSystemInput.text = fieldModel.get(idx).value || ""
    }

    function setIranSystemOutput(response) {
        if (iranSystemDirection.currentText === "Encode IranSys" && iranSystemTextEncoding.currentText === "UTF-8") {
            iranSystemOutputText = response.utf8Display || response.text || ""
            iranSystemOutputMeta = response.rawHex ? ("Hex: " + response.rawHex) : ""
        } else if (iranSystemTextEncoding.currentText === "ANSI") {
            iranSystemOutputText = response.ansiDisplay || ""
            iranSystemOutputMeta = response.rawHex ? ("Hex: " + response.rawHex) : ""
        } else {
            iranSystemOutputText = response.text || ""
            iranSystemOutputMeta = response.rawHex ? ("Hex: " + response.rawHex) : ""
        }
    }

    function convertIranSystemToUtf8Text(text) {
        return parseJsonSafe(backend.iranSystemTextToUtf8(text))
    }

    function convertUtf8ToIranSystemText(text) {
        return parseJsonSafe(backend.utf8ToIranSystemText(text, iranSystemConvertDigits.checked))
    }

    function convertAnsiHexToUtf8Text(text) {
        return parseJsonSafe(backend.ansiHexToUtf8Text(text))
    }

    function convertUtf8ToAnsiHex(text) {
        return parseJsonSafe(backend.utf8ToAnsiHex(text))
    }

    function swapIranSystemDirection() {
        var currentInput = iranSystemInput.text
        iranSystemInput.text = iranSystemOutputText
        iranSystemOutputText = currentInput
        iranSystemOutputMeta = ""
    }

    function runIranSystemConversion() {
        lastError = ""
        iranSystemOutputMeta = ""
        var direction = iranSystemDirection.currentText
        var response = { ok: false, error: "Unsupported conversion mode." }

        if (iranSystemProfile.currentIndex === 1) {
            if (direction === "Encode IranSys") {
                response = parseJsonSafe(backend.unicodeToAtmEngineIranSystem(
                                             iranSystemInput.text,
                                             iranSystemConvertDigits.checked))
                if (response.ok && iranSystemTextEncoding.currentText === "ANSI") {
                    var engineAnsi = convertAnsiHexToUtf8Text(response.rawHex || "")
                    if (!engineAnsi.ok) {
                        lastError = engineAnsi.error
                        return
                    }
                    response.ansiDisplay = engineAnsi.text || ""
                } else if (response.ok && iranSystemTextEncoding.currentText === "UTF-8") {
                    var engineUtf8 = parseJsonSafe(backend.hexToUtf8(response.rawHex || ""))
                    response.utf8Display = engineUtf8.ok ? (engineUtf8.text || "") : ""
                } else if (response.ok) {
                    response.text = response.rawHex || ""
                }
            } else if (iranSystemTextEncoding.currentText === "ANSI") {
                var engineInputHex = convertUtf8ToAnsiHex(iranSystemInput.text)
                if (!engineInputHex.ok) {
                    lastError = engineInputHex.error
                    return
                }
                response = parseJsonSafe(backend.atmEngineIranSystemToUnicode(
                                             engineInputHex.rawHex || "", true))
                if (response.ok) response.ansiDisplay = response.text || ""
            } else {
                response = parseJsonSafe(backend.atmEngineIranSystemToUnicode(
                                             iranSystemInput.text,
                                             iranSystemTextEncoding.currentText === "Hex"))
            }

            if (!response.ok) {
                lastError = response.error
                return
            }
            setIranSystemOutput(response)
            return
        }

        if (direction === "Decode IranSys" && iranSystemTextEncoding.currentText === "Hex") {
            response = parseJsonSafe(backend.iranSystemToUnicode(iranSystemInput.text, true))
        } else if (direction === "Decode IranSys" && iranSystemTextEncoding.currentText === "UTF-8") {
            response = convertIranSystemToUtf8Text(iranSystemInput.text)
        } else if (direction === "Decode IranSys" && iranSystemTextEncoding.currentText === "ANSI") {
            response = convertIranSystemToUtf8Text(iranSystemInput.text)
            if (response.ok) {
                var decodedAnsiDisplay = convertAnsiHexToUtf8Text(response.rawHex || "")
                if (!decodedAnsiDisplay.ok) {
                    lastError = decodedAnsiDisplay.error
                    return
                }
                response.ansiDisplay = decodedAnsiDisplay.text || ""
            }
        } else if (direction === "Encode IranSys") {
            if (iranSystemTextEncoding.currentText === "Hex") {
                response = parseJsonSafe(backend.unicodeToIranSystem(
                                             iranSystemInput.text,
                                             iranSystemConvertDigits.checked))
                if (response.ok) response.text = response.rawHex || ""
            } else if (iranSystemTextEncoding.currentText === "ANSI") {
                var ansiResponse = parseJsonSafe(backend.utf8ToAnsiText(iranSystemInput.text))
                if (!ansiResponse.ok) {
                    lastError = ansiResponse.error
                    return
                }
                response = convertUtf8ToIranSystemText(ansiResponse.text || "")
                if (response.ok) {
                    var encodedAnsiDisplay = convertAnsiHexToUtf8Text(response.rawHex || "")
                    if (!encodedAnsiDisplay.ok) {
                        lastError = encodedAnsiDisplay.error
                        return
                    }
                    response.ansiDisplay = encodedAnsiDisplay.text || ""
                }
            } else {
                response = convertUtf8ToIranSystemText(iranSystemInput.text)
                if (response.ok) {
                    var encodedUtf8Display = parseJsonSafe(backend.hexToUtf8(response.rawHex || ""))
                    if (!encodedUtf8Display.ok) {
                        lastError = encodedUtf8Display.error
                        return
                    }
                    response.utf8Display = encodedUtf8Display.text || ""
                }
            }
        }

        if (!response.ok) {
            lastError = response.error
            return
        }
        setIranSystemOutput(response)
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
        height: 472
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
                    applyLegacyFraming()
                }
            }

            CheckBox {
                id: legacyEngineMode
                text: "Legacy ATM Engine"
                checked: false
                Layout.fillWidth: true
                ToolTip.visible: hovered
                ToolTip.text: "Use AlmasPlus packed BCD, binary bitmap, length-prefix, and field-flag rules"
                onToggled: {
                    backend.setLegacyEngineMode(checked)
                    applyLegacyFraming()
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
        id: pinPanel
        width: 500
        height: 630
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: pinButton.x
        y: pinOpen ? (pinButton.y - height - 10) : (parent.height + 24)
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
                text: "PIN Tools"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            Label {
                text: pinTool.currentIndex === 1 ? "Generate a Visa PIN Verification Value."
                      : (pinTool.currentIndex === 2 ? "Calculate or verify an IBM 3624 PIN offset."
                      : (pinTool.currentIndex === 3
                      ? "Translate ATM-engine ANSI/ISO-1 blocks between DES, 2-key 3DES, or destination-only TSN-DES."
                      : (pinFormat.currentIndex === 3
                      ? "ISO-4 creates and decodes an AES-encrypted 16-byte PIN block."
                      : "Create or decode ISO PIN blocks; optionally transform them with 3DES-ECB.")))
                font.pixelSize: 11
                color: muted
                Layout.fillWidth: true
                wrapMode: Text.WordWrap
            }

            ComboBox {
                id: pinTool
                model: ["PIN Blocks", "Visa PVV", "IBM 3624", "ATM Translate"]
                Layout.fillWidth: true
                Layout.preferredHeight: 32
            }

            ComboBox {
                id: pinFormat
                model: ["ISO-0", "ISO-1", "ISO-3", "ISO-4"]
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 0
            }

            TextField {
                id: pinPan
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: "PAN"
                visible: pinTool.currentIndex !== 2
                enabled: pinTool.currentIndex === 1 || pinTool.currentIndex === 3 || pinFormat.currentIndex !== 1
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
                id: pinClearPin
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: "Clear PIN"
                visible: pinTool.currentIndex !== 3
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
                id: pinClearBlock
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: "Clear " + pinFormat.currentText + " PIN block hex"
                visible: pinTool.currentIndex === 0 && pinFormat.currentIndex !== 3
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
                id: pinKey
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                visible: pinTool.currentIndex !== 3
                placeholderText: pinTool.currentIndex === 0 && pinFormat.currentIndex === 3
                                 ? "AES key hex (16, 24, or 32 bytes)"
                                 : (pinTool.currentIndex === 0
                                    ? "PIN key hex (16 or 24 bytes for optional 3DES)"
                                    : "PVK hex (8, 16, or 24 bytes)")
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
                id: pinEncryptedBlock
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: pinFormat.currentIndex === 3
                                 ? "Encrypted ISO-4 PIN block hex"
                                 : "3DES encrypted PIN block hex"
                visible: pinTool.currentIndex === 0
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

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                visible: pinTool.currentIndex === 0
                AppButton {
                    text: "Create"
                    Layout.fillWidth: true
                    onClicked: createPinBlock()
                }
                AppButton {
                    text: "Decode"
                    Layout.fillWidth: true
                    onClicked: decodePinBlock()
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                visible: pinTool.currentIndex === 0
                AppButton {
                    text: "Encrypt"
                    Layout.fillWidth: true
                    enabled: pinFormat.currentIndex !== 3
                    onClicked: encryptPinBlock()
                }
                AppButton {
                    text: "Decrypt"
                    Layout.fillWidth: true
                    enabled: pinFormat.currentIndex !== 3
                    onClicked: decryptPinBlock()
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                visible: pinTool.currentIndex === 0
                AppButton {
                    text: "Load F52"
                    Layout.fillWidth: true
                    onClicked: loadPinField52()
                }
                AppButton {
                    text: "Apply F52"
                    Layout.fillWidth: true
                    onClicked: applyPinField52()
                }
            }

            TextField {
                id: pinPvki
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 1
                placeholderText: "PVKI (one digit)"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            TextField {
                id: pinValidationData
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 2
                placeholderText: "Validation data (16 digits)"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            TextField {
                id: pinDecimalization
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 2
                text: "0123456789012345"
                placeholderText: "Decimalization table (16 digits)"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            TextField {
                id: pinOffset
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 2
                placeholderText: "PIN offset"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: 8
                visible: pinTool.currentIndex === 1 || pinTool.currentIndex === 2
                AppButton { text: pinTool.currentIndex === 1 ? "Calculate PVV" : "Calculate Offset"; Layout.fillWidth: true; onClicked: calculatePinVerification() }
                AppButton { text: "Verify"; Layout.fillWidth: true; visible: pinTool.currentIndex === 2; onClicked: verifyIbmPin() }
            }

            TextField {
                id: pinVerificationResult
                Layout.fillWidth: true; Layout.preferredHeight: 32; readOnly: true
                visible: pinTool.currentIndex === 1 || pinTool.currentIndex === 2
                placeholderText: "Verification result"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            TextField {
                id: pinTranslateSourceBlock
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 3
                placeholderText: "Source encrypted PIN block hex"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: 8; visible: pinTool.currentIndex === 3
                ComboBox {
                    id: pinTranslateSourceFormat
                    model: ["ANSI / ISO-0 (ATM)", "ISO-1 (ATM)"]
                    Layout.fillWidth: true; Layout.preferredHeight: 32
                }
                ComboBox {
                    id: pinTranslateSourceAlgorithm
                    model: ["DES", "2-key 3DES"]
                    Layout.fillWidth: true; Layout.preferredHeight: 32
                }
            }

            TextField {
                id: pinTranslateSourceKey
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 3
                placeholderText: "Source key hex (8-byte DES or 16-byte 3DES)"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                echoMode: TextInput.Password
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: 8; visible: pinTool.currentIndex === 3
                ComboBox {
                    id: pinTranslateDestinationFormat
                    model: ["ANSI / ISO-0 (ATM)", "ISO-1 (ATM)"]
                    Layout.fillWidth: true; Layout.preferredHeight: 32
                }
                ComboBox {
                    id: pinTranslateDestinationAlgorithm
                    model: ["DES", "2-key 3DES", "TSN-DES"]
                    Layout.fillWidth: true; Layout.preferredHeight: 32
                }
            }

            TextField {
                id: pinTranslateDestinationKey
                Layout.fillWidth: true; Layout.preferredHeight: 32
                visible: pinTool.currentIndex === 3
                placeholderText: pinTranslateDestinationAlgorithm.currentIndex === 0
                                 ? "Destination DES key hex (8 bytes)"
                                 : "Destination key hex (16 bytes)"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                echoMode: TextInput.Password
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            RowLayout {
                Layout.fillWidth: true; spacing: 8; visible: pinTool.currentIndex === 3
                AppButton {
                    text: "Load F52"; Layout.fillWidth: true
                    onClicked: {
                        loadPinField52()
                        pinTranslateSourceBlock.text = pinEncryptedBlock.text
                    }
                }
                AppButton { text: "Translate"; Layout.fillWidth: true; onClicked: translateAtmPinBlock() }
                AppButton {
                    text: "Apply F52"; Layout.fillWidth: true
                    enabled: pinTranslateOutput.text.length > 0
                    onClicked: {
                        pinEncryptedBlock.text = pinTranslateOutput.text
                        applyPinField52()
                    }
                }
            }

            TextField {
                id: pinTranslateOutput
                Layout.fillWidth: true; Layout.preferredHeight: 32; readOnly: true
                visible: pinTool.currentIndex === 3
                placeholderText: "Translated encrypted PIN block hex"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }
        }
    }

    Rectangle {
        id: rsaPanel
        width: 470
        height: 570
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: rsaButton.x
        y: rsaOpen ? (rsaButton.y - height - 10) : (parent.height + 24)
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
                text: "RSA-SHA"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                ComboBox {
                    id: rsaDigest
                    model: ["SHA-256", "SHA-1", "SHA-512"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
                AppButton {
                    text: "Sign"
                    Layout.preferredWidth: 72
                    onClicked: signRsaSha()
                }
                AppButton {
                    text: "Verify"
                    Layout.preferredWidth: 72
                    onClicked: verifyRsaSha()
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                ComboBox {
                    id: rsaPadding
                    model: ["OAEP SHA-256", "OAEP SHA-1", "PKCS1 v1.5"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
                AppButton {
                    text: "Encrypt"
                    Layout.preferredWidth: 72
                    onClicked: encryptRsa()
                }
                AppButton {
                    text: "Decrypt"
                    Layout.preferredWidth: 72
                    onClicked: decryptRsa()
                }
            }

            TextArea {
                id: rsaPayload
                Layout.fillWidth: true
                Layout.preferredHeight: 80
                placeholderText: "Payload text"
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

            TextArea {
                id: rsaPrivateKey
                Layout.fillWidth: true
                Layout.preferredHeight: 110
                placeholderText: "Private key PEM"
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

            TextArea {
                id: rsaPublicKey
                Layout.fillWidth: true
                Layout.preferredHeight: 90
                placeholderText: "Public key PEM"
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

            TextArea {
                id: rsaSignature
                Layout.fillWidth: true
                Layout.fillHeight: true
                placeholderText: "Base64 signature"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                wrapMode: TextArea.WrapAnywhere
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                    border.width: 1
                }
            }

            Label {
                text: rsaVerifyStatus
                font.pixelSize: 11
                color: rsaVerifyStatus === "Match" ? "#63E6BE"
                      : (rsaVerifyStatus === "Mismatch" ? "#E18A74" : muted)
                Layout.fillWidth: true
            }
        }
    }

    Rectangle {
        id: tlvPanel
        width: 460
        height: 600
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
                ComboBox {
                    id: tlvMode
                    model: ["Parse", "Build", "TLV to XML", "XML to TLV"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
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
                    visible: tlvMode.currentIndex === 0 || tlvMode.currentIndex === 2
                }
                ComboBox {
                    id: tlvInputMode
                    model: ["Hex In", "Text In"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                    visible: tlvMode.currentIndex === 0 || tlvMode.currentIndex === 2
                }
                TextField {
                    id: tlvTagInput
                    Layout.fillWidth: true
                    Layout.preferredHeight: 32
                    visible: tlvMode.currentIndex === 1
                    placeholderText: "Tag hex"
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
                ComboBox {
                    id: tlvValueMode
                    model: ["Hex Value", "Text Value"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                    visible: tlvMode.currentIndex === 1
                }
                AppButton {
                    text: "Load Field"
                    visible: tlvMode.currentIndex === 0 || tlvMode.currentIndex === 2
                    onClicked: loadTlvField()
                }
                AppButton {
                    text: tlvMode.currentIndex === 0 ? "Parse"
                          : (tlvMode.currentIndex === 1 ? "Build" : "Convert")
                    onClicked: {
                        if (tlvMode.currentIndex === 0) {
                            parseTlvInput()
                        } else if (tlvMode.currentIndex === 1) {
                            buildTlvInput()
                        } else {
                            convertTlvXml()
                        }
                    }
                }
            }

            CheckBox {
                id: tlvConstructed
                text: "Constructed TLV (input is child TLV hex)"
                checked: false
                visible: tlvMode.currentIndex === 1
                Layout.fillWidth: true
            }

            TextArea {
                id: tlvInput
                Layout.fillWidth: true
                Layout.preferredHeight: 96
                placeholderText: tlvMode.currentIndex === 0 ? "TLV input"
                                 : (tlvMode.currentIndex === 2 ? "TLV input to convert to editable XML"
                                 : (tlvMode.currentIndex === 3 ? "Editable TLV XML"
                                 : (tlvConstructed.checked ? "Child TLV hex payload" :
                                    (tlvValueMode.currentIndex === 0 ? "Value hex" : "Value text"))))
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
                text: "Encoded"
                font.pixelSize: 12
                font.weight: Font.DemiBold
                color: ink
            }

            TextArea {
                Layout.fillWidth: true
                Layout.preferredHeight: 64
                readOnly: true
                text: tlvOutputHex
                placeholderText: "Encoded TLV hex"
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
        id: iranSystemPanel
        width: 460
        height: 500
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: iranSystemButton.x
        y: iranSystemOpen ? (iranSystemButton.y - height - 10) : (parent.height + 24)
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
                text: "IranSystem"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                SpinBox {
                    id: iranSystemFieldId
                    from: 0
                    to: 128
                    value: 48
                    editable: true
                    Layout.preferredWidth: 90
                }
                AppButton {
                    text: "Load Field"
                    onClicked: loadIranSystemField()
                }
                ComboBox {
                    id: iranSystemProfile
                    model: ["Normalized", "ATM Engine"]
                    currentIndex: 0
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                Label {
                    text: "Mode"
                    color: ink
                    font.pixelSize: 12
                    Layout.alignment: Qt.AlignVCenter
                }
                ComboBox {
                    id: iranSystemDirection
                    model: ["Decode IranSys", "Encode IranSys"]
                    currentIndex: 0
                    Layout.fillWidth: true
                }
                Label {
                    text: "Encoding"
                    color: ink
                    font.pixelSize: 12
                    Layout.alignment: Qt.AlignVCenter
                }
                ComboBox {
                    id: iranSystemTextEncoding
                    model: ["UTF-8", "ANSI", "Hex"]
                    currentIndex: 0
                    Layout.fillWidth: true
                }
                AppButton {
                    text: "Convert"
                    Layout.preferredWidth: 88
                    onClicked: runIranSystemConversion()
                }
            }

            CheckBox {
                id: iranSystemConvertDigits
                text: "Convert digits to IranSystem"
                checked: true
                Layout.fillWidth: true
                visible: iranSystemDirection.currentText === "Encode IranSys"
                enabled: visible
            }

            TextArea {
                id: iranSystemInput
                Layout.fillWidth: true
                Layout.preferredHeight: 120
                placeholderText: iranSystemDirection.currentText === "Decode IranSys"
                                 ? (iranSystemProfile.currentIndex === 1
                                    ? "ATM-engine IranSystem bytes (select ANSI or Hex)"
                                    : "IranSystem input")
                                 : "Text input"
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
                text: iranSystemDirection.currentText === "Decode IranSys"
                      ? ("Output (" + iranSystemTextEncoding.currentText + ")")
                      : "IranSystem Output"
                font.pixelSize: 12
                font.weight: Font.DemiBold
                color: ink
            }

            TextArea {
                Layout.fillWidth: true
                Layout.fillHeight: true
                readOnly: true
                text: iranSystemOutputText
                placeholderText: "Converted text"
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
                visible: iranSystemOutputMeta.length > 0
                text: iranSystemOutputMeta
                color: muted
                font.pixelSize: 11
                Layout.fillWidth: true
                wrapMode: Text.WrapAnywhere
            }
        }
    }

    Rectangle {
        id: bankingToolsPanel
        width: 430
        height: 470
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: Math.min(bankingToolsButton.x, parent.width - width - 24)
        y: bankingToolsOpen ? (bankingToolsButton.y - height - 10) : (parent.height + 24)
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
                text: "Banking Tools"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            ComboBox {
                id: bankingOperation
                model: ["BCD Encode Left", "BCD Encode Right", "BCD Decode Left", "BCD Decode Right",
                        "XOR Hex", "Base64 Encode Text", "Base64 Encode Hex", "Base64 Decode Text",
                        "Base64 Decode Hex", "MD5", "SHA-1", "SHA-256", "SHA-512", "Luhn Check",
                        "Luhn Generate", "Adjust Odd Parity", "Check Odd Parity", "Random Key", "KCV",
                        "ASCII to EBCDIC", "EBCDIC to ASCII"]
                Layout.fillWidth: true
                Layout.preferredHeight: 32
            }

            RowLayout {
                Layout.fillWidth: true
                spacing: 8
                ComboBox {
                    id: bankingInputMode
                    model: ["Text input", "Hex input"]
                    Layout.fillWidth: true
                    Layout.preferredHeight: 30
                }
                SpinBox {
                    id: bankingParameter
                    from: 0
                    to: 64
                    value: 3
                    editable: true
                    Layout.preferredWidth: 110
                    ToolTip.visible: hovered
                    ToolTip.text: "Digit count, generated key bytes, or KCV output bytes"
                }
            }

            TextArea {
                id: bankingInput
                Layout.fillWidth: true
                Layout.preferredHeight: 92
                placeholderText: "Input"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                wrapMode: TextArea.WrapAnywhere
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                }
            }

            TextField {
                id: bankingSecondary
                Layout.fillWidth: true
                Layout.preferredHeight: 32
                placeholderText: "Second hex value (XOR)"
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

            AppButton {
                text: "Run"
                Layout.fillWidth: true
                onClicked: runBankingUtility()
            }

            TextArea {
                id: bankingOutput
                Layout.fillWidth: true
                Layout.fillHeight: true
                readOnly: true
                placeholderText: "Output"
                color: ink
                font.pixelSize: 13
                placeholderTextColor: muted
                wrapMode: TextArea.WrapAnywhere
                selectByMouse: true
                background: Rectangle {
                    radius: 8
                    color: "#121922"
                    border.color: border
                }
            }
        }
    }

    Rectangle {
        id: networkPanel
        width: 480
        height: 500
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: Math.min(networkButton.x, parent.width - width - 24)
        y: networkOpen ? (networkButton.y - height - 10) : (parent.height + 24)
        z: 10
        opacity: 0.15 + 0.85 * intro

        Behavior on y { NumberAnimation { duration: 220; easing.type: Easing.OutCubic } }

        ColumnLayout {
            anchors.fill: parent
            anchors.margins: 16
            spacing: 10

            Label { text: "ISO TCP Tester"; font.pixelSize: 13; font.weight: Font.DemiBold; color: ink }

            RowLayout {
                Layout.fillWidth: true
                TextField {
                    id: networkHost
                    Layout.fillWidth: true
                    Layout.preferredHeight: 32
                    placeholderText: "Host or IP address"
                    color: ink; font.pixelSize: 13; placeholderTextColor: muted; selectByMouse: true
                    background: Rectangle { radius: 8; color: "#121922"; border.color: border }
                }
                SpinBox { id: networkPort; from: 1; to: 65535; value: 5000; editable: true; Layout.preferredWidth: 110 }
                SpinBox { id: networkTimeout; from: 100; to: 120000; value: 5000; stepSize: 100; editable: true; Layout.preferredWidth: 110 }
            }

            RowLayout {
                Layout.fillWidth: true
                ComboBox { id: networkInputMode; model: ["Hex", "Text"]; Layout.fillWidth: true; Layout.preferredHeight: 30 }
                ComboBox { id: networkFraming; model: ["None", "ASCII", "Binary"]; Layout.fillWidth: true; Layout.preferredHeight: 30 }
                SpinBox {
                    id: networkHeaderSize
                    from: 1; to: networkFraming.currentIndex === 2 ? 4 : 8
                    value: networkFraming.currentIndex === 2 ? 2 : 4
                    editable: true; Layout.preferredWidth: 86
                    enabled: networkFraming.currentIndex !== 0
                }
                ComboBox { id: networkOutputMode; model: ["Hex Out", "Text Out"]; Layout.fillWidth: true; Layout.preferredHeight: 30 }
            }

            TextArea {
                id: networkPayload
                Layout.fillWidth: true; Layout.preferredHeight: 100
                placeholderText: "ISO 8583 request body"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted
                wrapMode: TextArea.WrapAnywhere; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }

            RowLayout {
                Layout.fillWidth: true
                AppButton {
                    text: "Load Buffer"; Layout.fillWidth: true
                    onClicked: {
                        networkPayload.text = decodeInput.text
                        networkInputMode.currentIndex = bufferEncoding.currentIndex
                    }
                }
                AppButton { text: "Send"; Layout.fillWidth: true; onClicked: sendNetworkRequest() }
            }

            TextArea {
                id: networkResponse
                Layout.fillWidth: true; Layout.fillHeight: true; readOnly: true
                placeholderText: "Response body"
                color: ink; font.pixelSize: 13; placeholderTextColor: muted
                wrapMode: TextArea.WrapAnywhere; selectByMouse: true
                background: Rectangle { radius: 8; color: "#121922"; border.color: border }
            }
            Label {
                id: networkMeta
                Layout.fillWidth: true; color: muted; font.pixelSize: 11
                wrapMode: Text.WrapAnywhere
            }
        }
    }

    Rectangle {
        id: infoPanel
        width: 360
        height: 220
        radius: 18
        color: card
        border.color: border
        border.width: 1
        x: Math.min(infoButton.x, parent.width - width - 24)
        y: infoOpen ? (infoButton.y - height - 10) : (parent.height + 24)
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
                text: "Info"
                font.pixelSize: 13
                font.weight: Font.DemiBold
                color: ink
            }

            Rectangle {
                Layout.fillWidth: true
                Layout.fillHeight: true
                radius: 10
                color: "#121922"
                border.color: border
                border.width: 1

                ColumnLayout {
                    anchors.fill: parent
                    anchors.margins: 14
                    spacing: 10

                    Label {
                        text: "Creator"
                        font.pixelSize: 11
                        color: muted
                    }

                    Label {
                        text: "Amirsalar Saberi rad"
                        font.pixelSize: 15
                        font.weight: Font.DemiBold
                        color: ink
                    }

                    Label {
                        text: "All rights, ownership, and licensing for this app belong to Amirsalar Saberi rad."
                        color: ink
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                        Layout.fillWidth: true
                    }

                    Text {
                        text: "<a href=\"https://amirsrad.ir\">https://amirsrad.ir</a>"
                        textFormat: Text.RichText
                        color: accentCool
                        font.pixelSize: 12
                        wrapMode: Text.WrapAnywhere
                        Layout.fillWidth: true
                        onLinkActivated: function(link) { Qt.openUrlExternally(link) }
                    }

                    Item { Layout.fillHeight: true }
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
        id: pinButton
        text: pinOpen ? "PIN v" : "PIN >"
        anchors.left: macButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("pin")
            pinOpen = !pinOpen
            if (pinOpen) {
                closeToolPanels("pin")
            }
        }
    }

    AppButton {
        id: cryptoButton
        text: cryptoOpen ? "Crypto v" : "Crypto >"
        anchors.left: pinButton.right
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
        id: rsaButton
        text: rsaOpen ? "RSA v" : "RSA >"
        anchors.left: cryptoButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("rsa")
            rsaOpen = !rsaOpen
            if (rsaOpen) {
                closeToolPanels("rsa")
            }
        }
    }

    AppButton {
        id: tlvButton
        text: tlvOpen ? "TLV v" : "TLV >"
        anchors.left: rsaButton.right
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

    AppButton {
        id: iranSystemButton
        text: iranSystemOpen ? "IranSys v" : "IranSys >"
        anchors.left: tlvButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("iranSystem")
            iranSystemOpen = !iranSystemOpen
            if (iranSystemOpen) {
                closeToolPanels("iranSystem")
            }
        }
    }

    AppButton {
        id: bankingToolsButton
        text: bankingToolsOpen ? "Tools v" : "Tools >"
        anchors.left: iranSystemButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("bankingTools")
            bankingToolsOpen = !bankingToolsOpen
            if (bankingToolsOpen) {
                closeToolPanels("bankingTools")
            }
        }
    }

    AppButton {
        id: networkButton
        text: networkOpen ? "Network v" : "Network >"
        anchors.left: bankingToolsButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("network")
            networkOpen = !networkOpen
            if (networkOpen) closeToolPanels("network")
        }
    }

    AppButton {
        id: infoButton
        text: infoOpen ? "Info v" : "Info >"
        anchors.left: networkButton.right
        anchors.bottom: statusBar.bottom
        anchors.leftMargin: 8
        anchors.bottomMargin: 4
        height: 24
        padding: 6
        font.pixelSize: 11
        z: 11
        onClicked: {
            closeToolPanels("info")
            infoOpen = !infoOpen
            if (infoOpen) {
                closeToolPanels("info")
            }
        }
    }
}
