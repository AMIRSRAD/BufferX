#pragma once

#include <QObject>
#include <QString>

#include <vector>

#include "Iso8583.h"
#include "Packager.h"

class Backend : public QObject {
    Q_OBJECT

public:
    explicit Backend(QObject* parent = nullptr);

    Q_INVOKABLE QString defaultPackagerPath() const;
    Q_INVOKABLE QString loadPackagerFile(const QString& path);
    Q_INVOKABLE QString packagerFieldsJson(const QString& packagerName) const;
    Q_INVOKABLE QString choosePackagerFile() const;
    Q_INVOKABLE QString chooseBufferOpenFile() const;
    Q_INVOKABLE QString chooseBufferSaveFile() const;
    Q_INVOKABLE QString utf8ToHex(const QString& text) const;
    Q_INVOKABLE QString hexToUtf8(const QString& hexText) const;

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

    std::vector<Packager> packagers_;
};
