#pragma once

#include <QObject>
#include <QString>

#include <memory>

struct BackendState;
struct Packager;
enum class LengthFormat;

class Backend : public QObject {
    Q_OBJECT

public:
    explicit Backend(QObject* parent = nullptr);
    ~Backend() override;

    Q_INVOKABLE void setLegacyEngineMode(bool enabled);
    Q_INVOKABLE bool legacyEngineMode() const;

    Q_INVOKABLE QString defaultPackagerPath() const;
    Q_INVOKABLE QString loadPackagerFile(const QString& path);
    Q_INVOKABLE QString packagerFieldsJson(const QString& packagerName) const;
    Q_INVOKABLE QString choosePackagerFile() const;
    Q_INVOKABLE QString chooseBufferOpenFile() const;
    Q_INVOKABLE QString chooseBufferSaveFile() const;
    Q_INVOKABLE QString utf8ToHex(const QString& text) const;
    Q_INVOKABLE QString hexToUtf8(const QString& hexText) const;
    Q_INVOKABLE QString iranSystemToUnicode(const QString& payload, bool inputHex) const;
    Q_INVOKABLE QString unicodeToIranSystem(const QString& text, bool convertNumbers) const;
    Q_INVOKABLE QString iranSystemTextToUtf8(const QString& text) const;
    Q_INVOKABLE QString utf8ToIranSystemText(const QString& text, bool convertNumbers) const;
    Q_INVOKABLE QString atmEngineIranSystemToUnicode(const QString& payload, bool inputHex) const;
    Q_INVOKABLE QString unicodeToAtmEngineIranSystem(const QString& text, bool convertNumbers) const;
    Q_INVOKABLE QString asciiToUtf8Text(const QString& text) const;
    Q_INVOKABLE QString utf8ToAsciiText(const QString& text) const;
    Q_INVOKABLE QString ansiToUtf8Text(const QString& text) const;
    Q_INVOKABLE QString utf8ToAnsiText(const QString& text) const;
    Q_INVOKABLE QString ansiHexToUtf8Text(const QString& hexText) const;
    Q_INVOKABLE QString utf8ToAnsiHex(const QString& text) const;
    Q_INVOKABLE QString runBankingUtility(const QString& operation,
                                          const QString& input,
                                          const QString& secondary,
                                          int parameter) const;
    Q_INVOKABLE QString createIso0PinBlock(const QString& pin, const QString& pan) const;
    Q_INVOKABLE QString decodeIso0PinBlock(const QString& pinBlockHex, const QString& pan) const;
    Q_INVOKABLE QString createPinBlock(const QString& format,
                                       const QString& pin,
                                       const QString& pan,
                                       const QString& keyHex) const;
    Q_INVOKABLE QString decodePinBlock(const QString& format,
                                       const QString& pinBlockHex,
                                       const QString& pan,
                                       const QString& keyHex) const;
    Q_INVOKABLE QString encryptPinBlock(const QString& pinBlockHex, const QString& keyHex) const;
    Q_INVOKABLE QString decryptPinBlock(const QString& encryptedPinBlockHex, const QString& keyHex) const;
    Q_INVOKABLE QString calculateVisaPvv(const QString& pin,
                                         const QString& pan,
                                         const QString& pvki,
                                         const QString& pvkHex) const;
    Q_INVOKABLE QString calculateIbm3624Offset(const QString& pin,
                                               const QString& validationData,
                                               const QString& decimalizationTable,
                                               const QString& pvkHex) const;
    Q_INVOKABLE QString verifyIbm3624Pin(const QString& pin,
                                        const QString& offset,
                                        const QString& validationData,
                                        const QString& decimalizationTable,
                                        const QString& pvkHex) const;
    Q_INVOKABLE QString translateAtmPinBlock(const QString& encryptedBlockHex,
                                             const QString& pan,
                                             const QString& sourceFormat,
                                             const QString& sourceAlgorithm,
                                             const QString& sourceKeyHex,
                                             const QString& destinationFormat,
                                             const QString& destinationAlgorithm,
                                             const QString& destinationKeyHex) const;
    Q_INVOKABLE QString signRsaShaBase64(const QString& payload,
                                         const QString& privateKeyPem,
                                         const QString& digestName) const;
    Q_INVOKABLE QString verifyRsaShaBase64(const QString& payload,
                                           const QString& publicKeyPem,
                                           const QString& signatureBase64,
                                           const QString& digestName) const;
    Q_INVOKABLE QString encryptRsaBase64(const QString& payload,
                                         const QString& publicKeyPem,
                                         const QString& paddingName) const;
    Q_INVOKABLE QString decryptRsaBase64(const QString& ciphertextBase64,
                                         const QString& privateKeyPem,
                                         const QString& paddingName) const;

    Q_INVOKABLE QString decodeBuffer(const QString& packagerName,
                                     const QString& payload,
                                     bool inputHex,
                                     bool lengthHeaderEnabled,
                                     const QString& lengthMode,
                                     int lengthSize);

    Q_INVOKABLE QString encodeBuffer(const QString& packagerName,
                                     const QString& fieldsJson,
                                     bool outputHex,
                                     bool allowBinaryPadding,
                                     bool allowNumericSanitize,
                                     bool lengthHeaderEnabled,
                                     const QString& lengthMode,
                                     int lengthSize);

    Q_INVOKABLE QString calculateMacForFields(const QString& packagerName,
                                              const QString& fieldsJson,
                                              int macFieldId,
                                              const QString& keyHex,
                                              bool lengthHeaderEnabled,
                                              const QString& lengthMode,
                                              int lengthSize,
                                              const QString& paddingMode);

    Q_INVOKABLE QString verifyMacForFields(const QString& packagerName,
                                           const QString& fieldsJson,
                                           int macFieldId,
                                           const QString& keyHex,
                                           bool lengthHeaderEnabled,
                                           const QString& lengthMode,
                                           int lengthSize,
                                           const QString& paddingMode);

    Q_INVOKABLE QString transformCrypto(const QString& algorithm,
                                        const QString& operation,
                                        const QString& payload,
                                        bool inputHex,
                                        const QString& keyHex,
                                        const QString& ivHex,
                                        bool usePadding);

    Q_INVOKABLE QString parseTlv(const QString& payload, bool inputHex);
    Q_INVOKABLE QString validateTlv(const QString& payload, bool inputHex) const;
    Q_INVOKABLE QString tlvToXml(const QString& payload, bool inputHex) const;
    Q_INVOKABLE QString xmlToTlv(const QString& xml) const;
    Q_INVOKABLE QString sendTcpRequest(const QString& host,
                                       int port,
                                       const QString& payload,
                                       bool inputHex,
                                       const QString& framing,
                                       int headerSize,
                                       int timeoutMs) const;
    Q_INVOKABLE QString buildTlv(const QString& tagHex,
                                 const QString& payload,
                                 bool valueIsHex,
                                 bool constructed);

    Q_INVOKABLE QString saveBufferFile(const QString& path,
                                       const QString& packagerName,
                                       const QString& fieldsJson,
                                       const QString& raw,
                                       bool rawIsHex,
                                       bool autoDetect,
                                       bool lengthHeaderEnabled,
                                       const QString& lengthMode,
                                       int lengthSize);

    Q_INVOKABLE QString loadBufferFile(const QString& path);

private:
    Packager* findPackager(const QString& name);
    const Packager* findPackager(const QString& name) const;
    static LengthFormat parseLengthFormat(const QString& mode);
    static QString jsonError(const QString& message);

    std::unique_ptr<BackendState> state_;
};
