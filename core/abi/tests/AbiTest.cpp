// Drives the BufferX C ABI the way a host does: JSON text in through
// bufferx_invoke, JSON text out, nothing else touched. Nothing here reaches
// past the boundary into the C++ core -- the point is to prove the contract the
// Rust host and the WebAssembly glue depend on, including the parts that are
// promises rather than computations (never NULL, no exception escapes, state
// lives in the session).
//
// Standalone: no test framework, no build wiring.
//   c++ -std=c++17 AbiTest.cpp ../bufferx_abi.cpp ../JsonLite.cpp \
//       ../../src/*.cpp -I../ -I../../include -lcrypto -o AbiTest

#include <cstdio>
#include <string>
#include <vector>

#include "../JsonLite.h"
#include "../bufferx_abi.h"

namespace {

int failures = 0;

void check(bool condition, const std::string& label, const std::string& detail = {}) {
    if (condition) {
        std::printf("  [PASS] %s\n", label.c_str());
        return;
    }
    ++failures;
    std::printf("  [FAIL] %s%s\n", label.c_str(),
                detail.empty() ? "" : ("  -> " + detail).c_str());
}

void checkEqual(const std::string& actual, const std::string& expected, const std::string& label) {
    check(actual == expected, label, "got \"" + actual + "\", want \"" + expected + "\"");
}

// ---------------------------------------------------------------------------
// Envelope plumbing
// ---------------------------------------------------------------------------

// Builds `{"v":1,"op":...,"args":...}` through the serializer rather than by
// pasting strings, so an XML document or a key full of quotes is escaped the
// same way a real host would escape it.
std::string request(const std::string& op, json::Value args) {
    json::Value envelope = json::Value::object();
    envelope.set("v", json::Value(1));
    envelope.set("op", json::Value(op));
    envelope.set("args", std::move(args));
    return envelope.serialize();
}

// One round trip through the C boundary, including the free the contract
// requires. Takes `const char*` rather than `std::string` so the NULL-request
// case can be exercised at all. Returns the raw response text.
std::string invokeRaw(bufferx_session* session, const char* requestJson) {
    char* raw = bufferx_invoke(session, requestJson);
    if (raw == nullptr) {
        // The header promises this cannot happen; assert it rather than
        // crashing on the copy below.
        check(false, "bufferx_invoke returned NULL",
              requestJson == nullptr ? "<null request>" : requestJson);
        return std::string();
    }
    const std::string response(raw);
    bufferx_string_free(raw);
    return response;
}

std::string invoke(bufferx_session* session, const std::string& op, json::Value args) {
    return invokeRaw(session, request(op, std::move(args)).c_str());
}

// A parsed response plus the two questions every assertion asks of it.
struct Envelope {
    bool        parsed = false;
    bool        ok = false;
    json::Value data;
    std::string code;
    std::string message;
    std::string raw;
};

Envelope readEnvelope(const std::string& response) {
    Envelope envelope;
    envelope.raw = response;
    const json::ParseResult result = json::parse(response);
    if (!result.ok || !result.value.isObject()) {
        return envelope;
    }
    const json::Value* ok = result.value.find("ok");
    if (ok == nullptr || !ok->isBool()) {
        return envelope;
    }
    envelope.parsed = true;
    envelope.ok = ok->asBool();
    if (envelope.ok) {
        const json::Value* data = result.value.find("data");
        if (data != nullptr && data->isObject()) {
            envelope.data = *data;
        } else {
            envelope.parsed = false;   // success without an object `data` is malformed
        }
        return envelope;
    }
    const json::Value* error = result.value.find("error");
    if (error == nullptr || !error->isObject()) {
        envelope.parsed = false;
        return envelope;
    }
    const json::Value* code = error->find("code");
    const json::Value* message = error->find("message");
    if (code == nullptr || !code->isString() || message == nullptr || !message->isString()) {
        envelope.parsed = false;
        return envelope;
    }
    envelope.code = code->asString();
    envelope.message = message->asString();
    return envelope;
}

// Asserts a success envelope and hands back its `data`. On failure the returned
// object is an empty one, so the caller's follow-up reads report misses rather
// than crashing.
json::Value expectOk(bufferx_session* session, const std::string& op, json::Value args,
                     const std::string& label) {
    const Envelope envelope = readEnvelope(invoke(session, op, std::move(args)));
    if (!envelope.parsed) {
        check(false, label, "malformed envelope: " + envelope.raw);
        return json::Value::object();
    }
    if (!envelope.ok) {
        check(false, label, envelope.code + ": " + envelope.message);
        return json::Value::object();
    }
    check(true, label);
    return envelope.data;
}

void expectError(bufferx_session* session, const std::string& op, json::Value args,
                 const std::string& expectedCode, const std::string& label) {
    const Envelope envelope = readEnvelope(invoke(session, op, std::move(args)));
    if (!envelope.parsed) {
        check(false, label, "malformed envelope: " + envelope.raw);
        return;
    }
    if (envelope.ok) {
        check(false, label, "expected " + expectedCode + ", got a success envelope");
        return;
    }
    check(envelope.code == expectedCode, label,
          "expected " + expectedCode + ", got " + envelope.code + " (" + envelope.message + ")");
    // The secrecy rule is part of the contract, not a nicety: an error message
    // that quotes its argument leaks PINs and keys into host logs.
    check(!envelope.message.empty(), label + ": error carries a message");
}

// Reads `data.<key>` as a string, reporting a miss instead of silently
// defaulting -- a handler that forgot a member would otherwise pass.
std::string dataString(const json::Value& data, const std::string& key, const std::string& label) {
    const json::Value* value = data.find(key);
    if (value == nullptr || !value->isString()) {
        check(false, label + ": data." + key + " is a string");
        return std::string();
    }
    return value->asString();
}

json::Value object() { return json::Value::object(); }

json::Value args1(const std::string& key, json::Value value) {
    json::Value out = json::Value::object();
    out.set(key, std::move(value));
    return out;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A deliberately small packager: MTI, bitmap, one variable field, two fixed
// ones. Small enough that an encode result can be reasoned about by eye, and
// enough shapes that the decode side has to do real work.
const char* const kTestPackagerXml =
    "<Packagers>"
    "  <Packager Name=\"TEST\" MacMethod=\"NONE\" MacSize=\"0\" BitmapIndex=\"1\""
    "            SecondPartBitmap=\"64\" FieldCount=\"64\" LenFormat=\"NONE\" LenLen=\"0\">"
    "    <Field FieldId=\"0\"  FieldType=\"IFA_NUMERIC\" FieldLength=\"4\""
    "           FieldDesc=\"MESSAGE TYPE INDICATOR\" Flags=\"00\" />"
    "    <Field FieldId=\"1\"  FieldType=\"IFA_BITMAP\"  FieldLength=\"64\""
    "           FieldDesc=\"BIT MAP\" Flags=\"00\" />"
    "    <Field FieldId=\"2\"  FieldType=\"IFA_LLNUM\"   FieldLength=\"19\""
    "           FieldDesc=\"PAN - PRIMARY ACCOUNT NUMBER\" Flags=\"00\" />"
    "    <Field FieldId=\"3\"  FieldType=\"IFA_NUMERIC\" FieldLength=\"6\""
    "           FieldDesc=\"PROCESSING CODE\" Flags=\"00\" />"
    "    <Field FieldId=\"11\" FieldType=\"IFA_NUMERIC\" FieldLength=\"6\""
    "           FieldDesc=\"SYSTEM TRACE AUDIT NUMBER\" Flags=\"00\" />"
    "  </Packager>"
    "</Packagers>";

// The same packager with a MAC method and a field 64 to carry the MAC, so the
// mac.* ops have something to bind to.
const char* const kMacPackagerXml =
    "<Packagers>"
    "  <Packager Name=\"MACTEST\" MacMethod=\"FULL\" MacSize=\"16\" BitmapIndex=\"1\""
    "            SecondPartBitmap=\"64\" FieldCount=\"64\" LenFormat=\"NONE\" LenLen=\"0\">"
    "    <Field FieldId=\"0\"  FieldType=\"IFA_NUMERIC\" FieldLength=\"4\""
    "           FieldDesc=\"MESSAGE TYPE INDICATOR\" Flags=\"00\" />"
    "    <Field FieldId=\"1\"  FieldType=\"IFA_BITMAP\"  FieldLength=\"64\""
    "           FieldDesc=\"BIT MAP\" Flags=\"00\" />"
    "    <Field FieldId=\"2\"  FieldType=\"IFA_LLNUM\"   FieldLength=\"19\""
    "           FieldDesc=\"PAN - PRIMARY ACCOUNT NUMBER\" Flags=\"00\" />"
    "    <Field FieldId=\"3\"  FieldType=\"IFA_NUMERIC\" FieldLength=\"6\""
    "           FieldDesc=\"PROCESSING CODE\" Flags=\"00\" />"
    "    <Field FieldId=\"11\" FieldType=\"IFA_NUMERIC\" FieldLength=\"6\""
    "           FieldDesc=\"SYSTEM TRACE AUDIT NUMBER\" Flags=\"00\" />"
    "    <Field FieldId=\"64\" FieldType=\"IFA_BINARY\"  FieldLength=\"8\""
    "           FieldDesc=\"MESSAGE AUTHENTICATION CODE\" Flags=\"00\" />"
    "  </Packager>"
    "</Packagers>";

// A throwaway 2048-bit RSA pair generated for this file alone. It guards
// nothing and is not used anywhere else; the rsa.* ops need a real key to
// exercise, and a fixture that is checked in is the only way to make the
// signature round trip reproducible.
const char* const kTestPrivateKeyPem =
    "-----BEGIN PRIVATE KEY-----\n"
    "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDGQfy5EfdsbpRy\n"
    "cZrDaza2ai5RhQvOQBETUzn2kUEyqQNi/do9Ah35HGy5fD6jslALoLATwl98VHMm\n"
    "/gFNfkBhloXbBzcySpu6nEMUUmCyULFkwj4CcTMNU02T7rjyosF7wg7qEwNMkiiP\n"
    "4wxSOIW7udC3LbxebElTxdgRlG5V0sS9yQHfHfxX87dlnhrw0MnAFOb0rcyE48e7\n"
    "Q05F25nRgjH5mBoVV4uV2+wfOl61faLI/AoorJ/EbC/M9X1WLhF/Mf5g/JyI8rPB\n"
    "1IiLwlj4Z7znAbgitUBB07y4mV/FukERln/u7/X0ARmASSGrHtkVrBKGP2w+bo5o\n"
    "Be/VGDAvAgMBAAECggEAAsu0a3cFj68MLdmh7pEzpM/g1lUeIlWZ8rVQ6G608NNx\n"
    "pkg2dyIcAm10WmCWUOBMq6qjllZpL/YlkjkGaK2Cl+heUS/hXIwGdSkLSHKURX9z\n"
    "ePHE8RY1O5dfTS+ScRgldVV6Y1z1m3NQ2h1ACRAd+/8198H6hDRaYQbgXKMaCTYY\n"
    "zZsgRR1jHVw/ip0X0WM4ws09gdtWA3uZI+y8tTzFO0u6WUYfJQrI8UquzUgQu6qe\n"
    "g44B1pv5byLUePPbx9Rwm2U/6vIK5EvNSBowf2olEbLLb1AHv/NZiJVHNdCnSOOO\n"
    "D4t/GZGZV9/rsU8cgfAQ/vBNoFh3s0BMPZJUHsrBWQKBgQDvSlfEjvoAQXNYgcFO\n"
    "EY4fPbCmVw4zJosjJRHUy2JCXhtUPI9/V5FAbLjL/6WvOa/DT1oYjqPE3vT135XL\n"
    "kJjcUJ6hbgH87ndkPmEui4/Hpe845sj5cn7etieft7NsJPGG8Vd+IYg8WBKOkC4I\n"
    "XfPwh2D+JwFzaWnX8zp7GwA1BwKBgQDUGiCebevfoE3MTLfik4jMwmE2Sx51LVTS\n"
    "s66lBYmCRq0vjA7QQCAj5ZrzcWFvblFmpvalHZ5JtubUayKkbF81gSnId0Kwrxx1\n"
    "58fzBJcUTBdXgvpyhFNVJSPKhasPaMfo9WL6ThyicLEe+vahh11XiqfQAKohWlnw\n"
    "zV8X5XrJmQKBgCcm79NeXXNbQicyG9HNN4bPDi85QT6HSO64KwG5QVuAkFIpEoWQ\n"
    "a1iyMU5XhuFzu9lmC2THOe6FWGk+awECqLArlLjvCe47ildhiX8XILBW6xxRToLa\n"
    "A/4mqbcNVJMWPFqK9HjTvbm541dmKdH+pWIulGUhNrCOh93okyH/WfpTAoGBAMqQ\n"
    "gWKNXF3gfSyGgH/1owrbAXiW2WnTd1Ubocmcti0jTrdALc2Z0Jg36nphaErBsyA0\n"
    "iQ48cTW5Zk6sWxNpJKy2xK7dp2WSd73rNLzVP2x1Fz3Oq12/Hs8Mf1glvK8kxPep\n"
    "k3O2Mga5VY9e4zh1TSIUHBy85b6gyZD+srjhwxjRAoGBAI90fmbZkao6Xb3cJc6c\n"
    "Ryros7/f42QOLTbuhIDJ8J9pzTWJbiB4FFfiLeEDsNP/2aQZXUdlB2OYNZNrCSMv\n"
    "PgrfUbRFbdgXUU4jOdRo9alGHJ1DsdZNKF+FdgB7NyK1ej9945a0j05gXsn+f/BF\n"
    "5WT+QEja0Ku7IPj4dWKBxsr+\n"
    "-----END PRIVATE KEY-----\n";

const char* const kTestPublicKeyPem =
    "-----BEGIN PUBLIC KEY-----\n"
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxkH8uRH3bG6UcnGaw2s2\n"
    "tmouUYULzkARE1M59pFBMqkDYv3aPQId+RxsuXw+o7JQC6CwE8JffFRzJv4BTX5A\n"
    "YZaF2wc3MkqbupxDFFJgslCxZMI+AnEzDVNNk+648qLBe8IO6hMDTJIoj+MMUjiF\n"
    "u7nQty28XmxJU8XYEZRuVdLEvckB3x38V/O3ZZ4a8NDJwBTm9K3MhOPHu0NORduZ\n"
    "0YIx+ZgaFVeLldvsHzpetX2iyPwKKKyfxGwvzPV9Vi4RfzH+YPyciPKzwdSIi8JY\n"
    "+Ge85wG4IrVAQdO8uJlfxbpBEZZ/7u/19AEZgEkhqx7ZFawShj9sPm6OaAXv1Rgw\n"
    "LwIDAQAB\n"
    "-----END PUBLIC KEY-----\n";

json::Value isoField(int id, const std::string& value) {
    json::Value field = json::Value::object();
    field.set("id", json::Value(id));
    field.set("value", json::Value(value));
    return field;
}

} // namespace

// ---------------------------------------------------------------------------

int main() {
    bufferx_session* session = bufferx_open();
    if (session == nullptr) {
        std::printf("  [FAIL] bufferx_open returned NULL\n");
        std::printf("\n=== RESULT: FAILURES (1 failures) ===\n");
        return 1;
    }

    // --- engine ------------------------------------------------------------
    std::printf("=== engine ===\n");
    {
        const char* version = bufferx_version();
        check(version != nullptr && version[0] != '\0', "bufferx_version returns a string",
              version == nullptr ? "NULL" : version);

        const json::Value data = expectOk(session, "engine.version", object(), "engine.version");
        checkEqual(dataString(data, "version", "engine.version"), version == nullptr ? "" : version,
                   "engine.version reports the same version as bufferx_version()");
        const json::Value* protocol = data.find("protocol");
        check(protocol != nullptr && protocol->asInt(-1) == 1,
              "engine.version reports protocol 1",
              protocol == nullptr ? "absent" : std::to_string(protocol->asInt(-1)));
    }
    {
        const json::Value data =
            expectOk(session, "engine.capabilities", object(), "engine.capabilities");
        // The C ABI is pure computation; the Rust host overrides these.
        const char* const flags[] = {"tcp", "files", "keyFiles", "desktop"};
        for (const char* flag : flags) {
            const json::Value* value = data.find(flag);
            check(value != nullptr && value->isBool() && !value->asBool(),
                  std::string("engine.capabilities.") + flag + " is false");
        }
    }

    // --- envelope failures --------------------------------------------------
    std::printf("\n=== envelope ===\n");
    {
        expectError(session, "engine.doesNotExist", object(), "UNKNOWN_OP",
                    "an unrecognised op yields UNKNOWN_OP");
    }
    {
        // Malformed JSON must still come back as a well-formed envelope: the
        // host parses the response before it knows whether the request was
        // good, so a raw parse error here would be unrecoverable.
        const Envelope envelope = readEnvelope(invokeRaw(session, "{\"v\":1,\"op\":"));
        check(envelope.parsed, "malformed JSON yields a well-formed error envelope", envelope.raw);
        check(!envelope.ok && envelope.code == "BAD_ARGUMENT",
              "malformed JSON is classified BAD_ARGUMENT", envelope.code);
    }
    {
        const Envelope envelope = readEnvelope(invokeRaw(session, ""));
        check(envelope.parsed && !envelope.ok, "empty input yields an error envelope",
              envelope.raw);
    }
    {
        const Envelope envelope = readEnvelope(invokeRaw(session, nullptr));
        check(envelope.parsed && !envelope.ok && envelope.code == "BAD_ARGUMENT",
              "a NULL request pointer yields BAD_ARGUMENT rather than a crash", envelope.raw);
    }
    {
        // A version this engine does not serve is UNSUPPORTED, not BAD_ARGUMENT:
        // the request is well-formed, the engine is simply the wrong one.
        const Envelope envelope =
            readEnvelope(invokeRaw(session, "{\"v\":99,\"op\":\"engine.version\",\"args\":{}}"));
        check(envelope.parsed && !envelope.ok && envelope.code == "UNSUPPORTED",
              "an unknown protocol version yields UNSUPPORTED", envelope.code);
    }

    // --- packager -----------------------------------------------------------
    std::printf("\n=== packager ===\n");
    {
        const json::Value data = expectOk(session, "packager.loadXml",
                                          args1("xml", json::Value(kTestPackagerXml)),
                                          "packager.loadXml accepts an inline definition");
        const json::Value* count = data.find("count");
        check(count != nullptr && count->asInt(-1) == 1, "packager.loadXml reports one packager",
              count == nullptr ? "absent" : std::to_string(count->asInt(-1)));
        const json::Value* packagers = data.find("packagers");
        check(packagers != nullptr && packagers->isArray() && packagers->size() == 1,
              "packager.loadXml returns one summary");
        if (packagers != nullptr && packagers->size() == 1) {
            checkEqual(dataString(packagers->at(0), "name", "summary"), "TEST",
                       "the summary names the packager");
        }
    }
    {
        const json::Value data = expectOk(session, "packager.list", object(), "packager.list");
        const json::Value* packagers = data.find("packagers");
        check(packagers != nullptr && packagers->isArray() && packagers->size() == 1,
              "packager.list sees the packager loaded a moment ago");
    }
    {
        const json::Value data =
            expectOk(session, "packager.fields", args1("packager", json::Value("TEST")),
                     "packager.fields");
        const json::Value* fields = data.find("fields");
        check(fields != nullptr && fields->isArray() && fields->size() == 5,
              "packager.fields returns all five definitions",
              fields == nullptr ? "absent" : std::to_string(fields->size()));
        if (fields != nullptr && fields->size() == 5) {
            // Ascending id order is a contract: the UI renders the array as-is.
            const json::Value& first = fields->at(0);
            const json::Value* id = first.find("id");
            check(id != nullptr && id->asInt(-1) == 0, "the first field is field 0");
            const json::Value& pan = fields->at(2);
            checkEqual(dataString(pan, "desc", "field 2"), "PAN - PRIMARY ACCOUNT NUMBER",
                       "field 2 carries its description");
            const json::Value* variable = pan.find("variable");
            check(variable != nullptr && variable->asBool(), "field 2 is variable length");
        }
    }
    {
        expectError(session, "packager.fields", args1("packager", json::Value("NOT_LOADED")),
                    "UNKNOWN_PACKAGER", "an unloaded packager name yields UNKNOWN_PACKAGER");
    }
    {
        // State lives in the session, not in a global: a fresh session must not
        // see the registry loaded above. This is the property that keeps two
        // windows, or two browser tabs, from decoding with each other's file.
        //
        // A session now boots with the definitions compiled in from
        // data/packagers.xml, so "is it empty?" no longer tests anything. The
        // property that matters is that the inline TEST packager loaded into
        // `session` is absent here, and that this session has its own built-ins.
        bufferx_session* other = bufferx_open();
        check(other != nullptr, "a second session opens");
        if (other != nullptr) {
            const json::Value data =
                expectOk(other, "packager.list", object(), "packager.list on a fresh session");
            const json::Value* packagers = data.find("packagers");
            check(packagers != nullptr && packagers->isArray() && packagers->size() > 1,
                  "a fresh session carries the built-in definitions",
                  packagers == nullptr ? "absent" : std::to_string(packagers->size()));

            bool sawTest = false;
            if (packagers != nullptr) {
                for (std::size_t i = 0; i < packagers->size(); ++i) {
                    const json::Value* name = packagers->at(i).find("name");
                    if (name != nullptr && name->asString() == "TEST") sawTest = true;
                }
            }
            check(!sawTest,
                  "it does NOT see the other session's TEST packager -- state is per-session");

            // The first session still holds only what it loaded, unaffected.
            const json::Value mine =
                expectOk(session, "packager.list", object(), "the first session is unchanged");
            const json::Value* mineList = mine.find("packagers");
            check(mineList != nullptr && mineList->size() == 1,
                  "loadXml replaced the first session's registry and nothing re-seeded it",
                  mineList == nullptr ? "absent" : std::to_string(mineList->size()));

            bufferx_close(other);
        }
        // And a NULL session is served, not rejected.
        const Envelope envelope = readEnvelope(invoke(nullptr, "engine.version", object()));
        check(envelope.parsed && envelope.ok, "a NULL session is served by the default session",
              envelope.raw);
    }

    // --- iso ----------------------------------------------------------------
    std::printf("\n=== iso ===\n");
    {
        json::Value fields = json::Value::array();
        fields.push(isoField(0, "0200"));
        fields.push(isoField(2, "4321987654321098"));
        fields.push(isoField(3, "000000"));
        fields.push(isoField(11, "123456"));

        json::Value encodeArgs = json::Value::object();
        encodeArgs.set("packager", json::Value("TEST"));
        encodeArgs.set("fields", fields);

        const json::Value encoded = expectOk(session, "iso.encode", encodeArgs, "iso.encode");
        const std::string hex = dataString(encoded, "hex", "iso.encode");
        check(!hex.empty(), "iso.encode produces bytes");

        json::Value decodeArgs = json::Value::object();
        decodeArgs.set("packager", json::Value("TEST"));
        decodeArgs.set("payload", json::Value(hex));
        decodeArgs.set("inputHex", json::Value(true));

        const json::Value decoded = expectOk(session, "iso.decode", decodeArgs, "iso.decode");
        const json::Value* out = decoded.find("fields");
        check(out != nullptr && out->isArray() && out->size() == 4,
              "iso.decode round-trips the four fields it was given",
              out == nullptr ? "absent" : std::to_string(out->size()));
        if (out != nullptr && out->size() == 4) {
            const int wantIds[] = {0, 2, 3, 11};
            const char* const wantValues[] = {"0200", "4321987654321098", "000000", "123456"};
            for (std::size_t i = 0; i < 4; ++i) {
                const json::Value& field = out->at(i);
                const json::Value* id = field.find("id");
                const std::string label =
                    "field " + std::to_string(wantIds[i]) + " survives the round trip";
                if (id == nullptr || id->asInt(-1) != wantIds[i]) {
                    check(false, label, "unexpected id at position " + std::to_string(i));
                    continue;
                }
                checkEqual(dataString(field, "value", label), wantValues[i], label);
            }
            // Decode enriches each field with the packager metadata the UI
            // shows in the same table, so the frontend never joins responses.
            const json::Value& pan = out->at(1);
            checkEqual(dataString(pan, "desc", "decoded field 2"),
                       "PAN - PRIMARY ACCOUNT NUMBER", "decoded fields carry their description");
            checkEqual(dataString(pan, "hex", "decoded field 2"),
                       "34333231393837363534333231303938",
                       "decoded fields carry a hex rendering of the value");
            check(pan.find("type") != nullptr && pan.find("length") != nullptr &&
                      pan.find("variable") != nullptr,
                  "decoded fields carry type, length, and variability");
        }
    }
    {
        json::Value decodeArgs = json::Value::object();
        decodeArgs.set("packager", json::Value("TEST"));
        decodeArgs.set("payload", json::Value("00"));
        expectError(session, "iso.decode", decodeArgs, "DECODE_FAILED",
                    "a truncated message yields DECODE_FAILED");
    }

    // --- mac ----------------------------------------------------------------
    std::printf("\n=== mac ===\n");
    {
        // The TEST packager declares no MAC field, so MAC ops must be exercised
        // against a definition that does. Loading it replaces the registry, so
        // this runs on its own session and leaves the shared one alone.
        bufferx_session* macSession = bufferx_open();
        check(macSession != nullptr, "a session for the MAC packager opens");
        if (macSession != nullptr) {
            expectOk(macSession, "packager.loadXml", args1("xml", json::Value(kMacPackagerXml)),
                     "packager.loadXml accepts a MAC-bearing definition");

            json::Value fields = json::Value::array();
            fields.push(isoField(0, "0200"));
            fields.push(isoField(2, "4321987654321098"));
            fields.push(isoField(3, "000000"));
            fields.push(isoField(11, "123456"));

            json::Value macArgs = json::Value::object();
            macArgs.set("packager", json::Value("MACTEST"));
            macArgs.set("fields", fields);
            macArgs.set("macFieldId", json::Value(64));
            macArgs.set("keyHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));
            macArgs.set("paddingMode", json::Value("iso9797-1"));

            const json::Value calculated =
                expectOk(macSession, "mac.calculate", macArgs, "mac.calculate");
            const std::string macHex = dataString(calculated, "macHex", "mac.calculate");
            check(macHex.size() == 16, "mac.calculate returns an 8-byte MAC", macHex);

            // Verifying needs the received MAC in the message. Feeding back the
            // MAC just calculated must verify; flipping a digit must not.
            json::Value withMac = fields;
            withMac.push(isoField(64, macHex));
            json::Value verifyArgs = macArgs;
            verifyArgs.set("fields", withMac);

            const json::Value verified =
                expectOk(macSession, "mac.verify", verifyArgs, "mac.verify");
            const json::Value* valid = verified.find("valid");
            check(valid != nullptr && valid->isBool() && valid->asBool(),
                  "mac.verify accepts the MAC mac.calculate just produced");
            checkEqual(dataString(verified, "expectedHex", "mac.verify"), macHex,
                       "mac.verify reports the expected MAC");

            std::string tampered = macHex;
            tampered[0] = (tampered[0] == 'A') ? 'B' : 'A';
            json::Value tamperedFields = fields;
            tamperedFields.push(isoField(64, tampered));
            json::Value tamperArgs = macArgs;
            tamperArgs.set("fields", tamperedFields);

            const json::Value rejected =
                expectOk(macSession, "mac.verify", tamperArgs, "mac.verify on a tampered MAC");
            const json::Value* invalid = rejected.find("valid");
            check(invalid != nullptr && invalid->isBool() && !invalid->asBool(),
                  "mac.verify rejects a MAC that does not match");

            json::Value badPadding = macArgs;
            badPadding.set("paddingMode", json::Value("iso9797 m2"));
            expectError(macSession, "mac.calculate", badPadding, "BAD_ARGUMENT",
                        "a near-miss padding mode is refused rather than silently defaulted");

            json::Value badKey = macArgs;
            badKey.set("keyHex", json::Value("0123456789ABCD"));
            expectError(macSession, "mac.calculate", badKey, "BAD_LENGTH",
                        "a wrong-length MAC key yields BAD_LENGTH");

            bufferx_close(macSession);
        }
    }

    // --- crypto -------------------------------------------------------------
    std::printf("\n=== crypto ===\n");
    {
        const std::string key = "0123456789ABCDEFFEDCBA9876543210";
        const std::string plain = "41424344454647480102030405060708";

        json::Value encryptArgs = json::Value::object();
        encryptArgs.set("algorithm", json::Value("3DES-ECB"));
        encryptArgs.set("operation", json::Value("encrypt"));
        encryptArgs.set("payload", json::Value(plain));
        encryptArgs.set("inputHex", json::Value(true));
        encryptArgs.set("keyHex", json::Value(key));

        const json::Value encrypted =
            expectOk(session, "crypto.transform", encryptArgs, "crypto.transform 3DES-ECB encrypt");
        const std::string cipher = dataString(encrypted, "hex", "crypto.transform");
        check(cipher.size() == plain.size() && cipher != plain,
              "3DES-ECB without padding returns same-length, different bytes", cipher);

        json::Value decryptArgs = json::Value::object();
        decryptArgs.set("algorithm", json::Value("3DES-ECB"));
        decryptArgs.set("operation", json::Value("decrypt"));
        decryptArgs.set("payload", json::Value(cipher));
        decryptArgs.set("inputHex", json::Value(true));
        decryptArgs.set("keyHex", json::Value(key));

        const json::Value decrypted =
            expectOk(session, "crypto.transform", decryptArgs, "crypto.transform 3DES-ECB decrypt");
        checkEqual(dataString(decrypted, "hex", "crypto.transform"), plain,
                   "3DES-ECB round trip returns the original bytes");
    }
    {
        json::Value badArgs = json::Value::object();
        badArgs.set("algorithm", json::Value("3DES-ECB"));
        badArgs.set("operation", json::Value("encrypt"));
        badArgs.set("payload", json::Value("41424344454647480102030405060708"));
        badArgs.set("keyHex", json::Value("0123456789ABCDEFZZ"));
        expectError(session, "crypto.transform", badArgs, "BAD_HEX",
                    "a non-hex key yields BAD_HEX, not CRYPTO_FAILED");
    }
    {
        json::Value badArgs = json::Value::object();
        badArgs.set("algorithm", json::Value("3DES-ECB"));
        badArgs.set("operation", json::Value("sideways"));
        badArgs.set("payload", json::Value("0011223344556677"));
        badArgs.set("keyHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));
        expectError(session, "crypto.transform", badArgs, "BAD_ARGUMENT",
                    "an operation that is neither encrypt nor decrypt yields BAD_ARGUMENT");
    }

    // --- pin ----------------------------------------------------------------
    std::printf("\n=== pin ===\n");
    {
        // The canonical ISO-0 worked example: PIN 1234, PAN 43219876543210987.
        // 041234FFFFFFFFFF XOR 0000432198765432 -> 0412AC89ABCDEF67.
        json::Value createArgs = json::Value::object();
        createArgs.set("format", json::Value("iso0"));
        createArgs.set("pin", json::Value("1234"));
        createArgs.set("pan", json::Value("43219876543210987"));

        const json::Value created = expectOk(session, "pin.create", createArgs, "pin.create iso0");
        checkEqual(dataString(created, "hex", "pin.create"), "0412AC89ABCDEF67",
                   "pin.create iso0 produces the known block for 1234 / 43219876543210987");

        json::Value decodeArgs = json::Value::object();
        decodeArgs.set("format", json::Value("iso0"));
        decodeArgs.set("blockHex", json::Value("0412AC89ABCDEF67"));
        decodeArgs.set("pan", json::Value("43219876543210987"));

        const json::Value decoded = expectOk(session, "pin.decode", decodeArgs, "pin.decode iso0");
        checkEqual(dataString(decoded, "pin", "pin.decode"), "1234",
                   "pin.decode iso0 recovers the PIN");
    }
    {
        json::Value badArgs = json::Value::object();
        badArgs.set("format", json::Value("iso0"));
        badArgs.set("blockHex", json::Value("0412AC89ABCDEFGG"));
        badArgs.set("pan", json::Value("43219876543210987"));
        expectError(session, "pin.decode", badArgs, "BAD_HEX",
                    "a non-hex PIN block yields BAD_HEX");
    }
    {
        json::Value badArgs = json::Value::object();
        badArgs.set("format", json::Value("iso9"));
        badArgs.set("pin", json::Value("1234"));
        badArgs.set("pan", json::Value("43219876543210987"));
        expectError(session, "pin.create", badArgs, "BAD_ARGUMENT",
                    "an unknown PIN block format yields BAD_ARGUMENT");
    }

    {
        // Encrypt then decrypt a PIN block with the same key: the classic
        // single-DES / 3DES-ECB path pin.encrypt and pin.decrypt sit on.
        json::Value encryptArgs = json::Value::object();
        encryptArgs.set("blockHex", json::Value("0412AC89ABCDEF67"));
        encryptArgs.set("keyHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));

        const json::Value encrypted =
            expectOk(session, "pin.encrypt", encryptArgs, "pin.encrypt");
        const std::string cipher = dataString(encrypted, "hex", "pin.encrypt");
        check(cipher.size() == 16 && cipher != "0412AC89ABCDEF67",
              "pin.encrypt returns a different 8-byte block", cipher);

        json::Value decryptArgs = json::Value::object();
        decryptArgs.set("blockHex", json::Value(cipher));
        decryptArgs.set("keyHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));

        const json::Value decrypted =
            expectOk(session, "pin.decrypt", decryptArgs, "pin.decrypt");
        checkEqual(dataString(decrypted, "hex", "pin.decrypt"), "0412AC89ABCDEF67",
                   "pin.decrypt recovers the original PIN block");
    }
    {
        json::Value badArgs = json::Value::object();
        badArgs.set("blockHex", json::Value("0412AC89ABCDEF6789"));   // not a whole 8-byte block
        badArgs.set("keyHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));
        expectError(session, "pin.encrypt", badArgs, "BAD_LENGTH",
                    "a PIN block that is not a whole 8-byte multiple yields BAD_LENGTH");
    }
    {
        json::Value pvvArgs = json::Value::object();
        pvvArgs.set("pin", json::Value("1234"));
        pvvArgs.set("pan", json::Value("4321987654321098"));
        pvvArgs.set("pvki", json::Value("1"));
        pvvArgs.set("pvkHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));

        const json::Value data = expectOk(session, "pin.visaPvv", pvvArgs, "pin.visaPvv");
        const std::string pvv = dataString(data, "pvv", "pin.visaPvv");
        check(pvv.size() == 4, "pin.visaPvv returns four digits", pvv);

        // A form sends "1"; a numeric input sends 1. Same request, same answer.
        json::Value numericPvki = pvvArgs;
        numericPvki.set("pvki", json::Value(1));
        const json::Value alt =
            expectOk(session, "pin.visaPvv", numericPvki, "pin.visaPvv with a numeric pvki");
        checkEqual(dataString(alt, "pvv", "pin.visaPvv"), pvv,
                   "pvki is accepted as a string or a number, with the same result");
    }
    {
        json::Value offsetArgs = json::Value::object();
        offsetArgs.set("pin", json::Value("1234"));
        offsetArgs.set("validationData", json::Value("4321987654321098"));
        offsetArgs.set("decimalizationTable", json::Value("0123456789012345"));
        offsetArgs.set("pvkHex", json::Value("0123456789ABCDEFFEDCBA9876543210"));

        const json::Value data =
            expectOk(session, "pin.ibm3624Offset", offsetArgs, "pin.ibm3624Offset");
        const std::string offset = dataString(data, "offset", "pin.ibm3624Offset");
        check(offset.size() == 4, "pin.ibm3624Offset returns a four-digit offset", offset);

        // The offset just derived must verify against the PIN it came from.
        json::Value verifyArgs = offsetArgs;
        verifyArgs.set("offset", json::Value(offset));
        const json::Value verified =
            expectOk(session, "pin.verifyIbm3624", verifyArgs, "pin.verifyIbm3624");
        const json::Value* valid = verified.find("valid");
        check(valid != nullptr && valid->isBool() && valid->asBool(),
              "pin.verifyIbm3624 accepts the offset pin.ibm3624Offset produced");
        check(verified.find("naturalPin") != nullptr, "pin.verifyIbm3624 reports the natural PIN");

        json::Value wrongArgs = verifyArgs;
        wrongArgs.set("offset", json::Value(offset == "0000" ? "1111" : "0000"));
        const json::Value rejected =
            expectOk(session, "pin.verifyIbm3624", wrongArgs, "pin.verifyIbm3624 on a wrong offset");
        const json::Value* invalid = rejected.find("valid");
        check(invalid != nullptr && invalid->isBool() && !invalid->asBool(),
              "pin.verifyIbm3624 rejects an offset that does not match");
    }
    {
        // Translate an ISO-0 block from one 3DES key to another and confirm the
        // PIN survives the trip.
        //
        // NOTE the two PANs. The core derives the ISO-0 PAN block two different
        // ways: pinblock::createIso0 drops the check digit and takes the
        // rightmost 12 digits of what remains, while pintranslation takes the
        // rightmost 12 digits of the PAN as given. Passing the ATM path the
        // same PAN minus its check digit is what makes the two agree, and this
        // test is written that way deliberately -- if the conventions are ever
        // unified, this line is where it will be noticed.
        const std::string sourceKey = "0123456789ABCDEFFEDCBA9876543210";
        const std::string destKey = "FEDCBA98765432100123456789ABCDEF";
        const std::string pinBlockPan = "43219876543210987";   // as pin.create sees it
        const std::string atmPan = "4321987654321098";         // same PAN, check digit removed

        json::Value encryptArgs = json::Value::object();
        encryptArgs.set("blockHex", json::Value("0412AC89ABCDEF67"));   // ISO-0 of 1234 under pinBlockPan
        encryptArgs.set("keyHex", json::Value(sourceKey));
        const json::Value encrypted =
            expectOk(session, "pin.encrypt", encryptArgs, "pin.encrypt for the translation fixture");
        const std::string sourceBlock = dataString(encrypted, "hex", "pin.encrypt");

        json::Value translateArgs = json::Value::object();
        translateArgs.set("blockHex", json::Value(sourceBlock));
        translateArgs.set("pan", json::Value(atmPan));
        translateArgs.set("sourceFormat", json::Value("iso0"));
        translateArgs.set("sourceAlgorithm", json::Value("3des"));
        translateArgs.set("sourceKeyHex", json::Value(sourceKey));
        translateArgs.set("destinationFormat", json::Value("iso0"));
        translateArgs.set("destinationAlgorithm", json::Value("3des"));
        translateArgs.set("destinationKeyHex", json::Value(destKey));

        const json::Value data =
            expectOk(session, "pin.translateAtm", translateArgs, "pin.translateAtm");
        checkEqual(dataString(data, "pin", "pin.translateAtm"), "1234",
                   "pin.translateAtm recovers the PIN");
        checkEqual(dataString(data, "clearHex", "pin.translateAtm"), "0412AC89ABCDEF67",
                   "pin.translateAtm reports the clear block");
        const std::string translated = dataString(data, "translatedHex", "pin.translateAtm");
        check(translated.size() == 16 && translated != sourceBlock,
              "pin.translateAtm re-enciphers under the destination key", translated);
    }

    // --- rsa ----------------------------------------------------------------
    std::printf("\n=== rsa ===\n");
    {
        // Sign, verify, encrypt, decrypt against a throwaway 2048-bit pair
        // generated for this test alone. It is a test fixture, not a secret.
        json::Value signArgs = json::Value::object();
        signArgs.set("payload", json::Value("BufferX"));
        signArgs.set("privateKeyPem", json::Value(kTestPrivateKeyPem));
        signArgs.set("digest", json::Value("sha256"));

        const json::Value signed_ = expectOk(session, "rsa.sign", signArgs, "rsa.sign");
        const std::string signature = dataString(signed_, "signature", "rsa.sign");
        check(!signature.empty(), "rsa.sign returns a base64 signature");

        json::Value verifyArgs = json::Value::object();
        verifyArgs.set("payload", json::Value("BufferX"));
        verifyArgs.set("publicKeyPem", json::Value(kTestPublicKeyPem));
        verifyArgs.set("signature", json::Value(signature));
        verifyArgs.set("digest", json::Value("sha256"));

        const json::Value verified = expectOk(session, "rsa.verify", verifyArgs, "rsa.verify");
        const json::Value* valid = verified.find("valid");
        check(valid != nullptr && valid->isBool() && valid->asBool(),
              "rsa.verify accepts the signature rsa.sign produced");

        json::Value tampered = verifyArgs;
        tampered.set("payload", json::Value("BufferY"));
        const json::Value rejected =
            expectOk(session, "rsa.verify", tampered, "rsa.verify on altered payload");
        const json::Value* invalid = rejected.find("valid");
        check(invalid != nullptr && invalid->isBool() && !invalid->asBool(),
              "rsa.verify rejects a signature over different bytes");
    }
    {
        json::Value encryptArgs = json::Value::object();
        encryptArgs.set("payload", json::Value("BufferX"));
        encryptArgs.set("publicKeyPem", json::Value(kTestPublicKeyPem));
        encryptArgs.set("padding", json::Value("oaep"));

        const json::Value encrypted = expectOk(session, "rsa.encrypt", encryptArgs, "rsa.encrypt");
        const std::string ciphertext = dataString(encrypted, "ciphertext", "rsa.encrypt");
        check(!ciphertext.empty(), "rsa.encrypt returns base64 ciphertext");

        json::Value decryptArgs = json::Value::object();
        decryptArgs.set("ciphertext", json::Value(ciphertext));
        decryptArgs.set("privateKeyPem", json::Value(kTestPrivateKeyPem));
        decryptArgs.set("padding", json::Value("oaep"));

        const json::Value decrypted = expectOk(session, "rsa.decrypt", decryptArgs, "rsa.decrypt");
        checkEqual(dataString(decrypted, "plaintext", "rsa.decrypt"), "BufferX",
                   "rsa.decrypt recovers the plaintext");
    }
    {
        json::Value badArgs = json::Value::object();
        badArgs.set("payload", json::Value("BufferX"));
        badArgs.set("privateKeyPem", json::Value("-----BEGIN PRIVATE KEY-----\nnope\n"));
        badArgs.set("digest", json::Value("sha256"));
        expectError(session, "rsa.sign", badArgs, "CRYPTO_FAILED",
                    "an unreadable private key yields CRYPTO_FAILED");
    }

    // --- tools --------------------------------------------------------------
    std::printf("\n=== tools ===\n");
    {
        json::Value toolArgs = json::Value::object();
        toolArgs.set("operation", json::Value("sha256"));
        toolArgs.set("input", json::Value("abc"));

        const json::Value data = expectOk(session, "tools.run", toolArgs, "tools.run sha256");
        std::string digest = dataString(data, "output", "tools.run");
        for (char& c : digest) {
            if (c >= 'a' && c <= 'z') {
                c = static_cast<char>(c - 'a' + 'A');
            }
        }
        checkEqual(digest, "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
                   "tools.run sha256 matches the FIPS 180-2 test vector for \"abc\"");
    }
    {
        expectError(session, "tools.run", args1("operation", json::Value("nonesuch")),
                    "UNSUPPORTED", "an unimplemented tool operation yields UNSUPPORTED");
    }

    // --- tlv ----------------------------------------------------------------
    std::printf("\n=== tlv ===\n");
    {
        // 9F02 06 000000001000  -- amount, authorised. Primitive, one node.
        json::Value tlvArgs = json::Value::object();
        tlvArgs.set("payload", json::Value("9F0206000000001000"));
        tlvArgs.set("inputHex", json::Value(true));

        const json::Value data = expectOk(session, "tlv.parse", tlvArgs, "tlv.parse");
        const json::Value* nodes = data.find("nodes");
        check(nodes != nullptr && nodes->isArray() && nodes->size() == 1,
              "tlv.parse finds one node", nodes == nullptr ? "absent" : std::to_string(nodes->size()));
        if (nodes != nullptr && nodes->size() == 1) {
            const json::Value& node = nodes->at(0);
            const json::Value* length = node.find("length");
            check(length != nullptr && length->asInt(-1) == 6, "the node is six bytes long");
            const json::Value* composite = node.find("composite");
            check(composite != nullptr && composite->isBool() && !composite->asBool(),
                  "9F02 is primitive, not composite");
            check(node.find("tag") != nullptr && node.find("value") != nullptr &&
                      node.find("ascii") != nullptr && node.find("children") != nullptr,
                  "the node carries tag, value, ascii, and children");
        }
        check(data.find("tree") != nullptr && data.find("flat") != nullptr &&
                  data.find("inline") != nullptr,
              "tlv.parse returns the tree, flat, and inline renderings");
    }
    {
        // A length byte that promises more value than the buffer holds.
        json::Value tlvArgs = json::Value::object();
        tlvArgs.set("payload", json::Value("9F0206000000"));
        expectError(session, "tlv.parse", tlvArgs, "PARSE_FAILED",
                    "a truncated TLV yields PARSE_FAILED");
    }
    {
        json::Value tlvArgs = json::Value::object();
        tlvArgs.set("payload", json::Value("9F02060000000010ZZ"));
        expectError(session, "tlv.parse", tlvArgs, "BAD_HEX",
                    "a non-hex TLV payload yields BAD_HEX");
    }

    {
        json::Value buildArgs = json::Value::object();
        buildArgs.set("tagHex", json::Value("9F02"));
        buildArgs.set("payload", json::Value("000000001000"));
        buildArgs.set("valueIsHex", json::Value(true));
        buildArgs.set("constructed", json::Value(false));

        const json::Value data = expectOk(session, "tlv.build", buildArgs, "tlv.build");
        checkEqual(dataString(data, "hex", "tlv.build"), "9F0206000000001000",
                   "tlv.build reproduces the TLV tlv.parse read");
    }
    {
        // The constructed bit lives in the tag. Claiming otherwise is a
        // mistake worth reporting, not something to resolve silently.
        json::Value badArgs = json::Value::object();
        badArgs.set("tagHex", json::Value("9F02"));
        badArgs.set("payload", json::Value("000000001000"));
        badArgs.set("constructed", json::Value(true));
        expectError(session, "tlv.build", badArgs, "BAD_ARGUMENT",
                    "tlv.build refuses a 'constructed' flag that contradicts the tag");
    }
    {
        const json::Value data =
            expectOk(session, "tlv.validate", args1("payload", json::Value("9F0206000000001000")),
                     "tlv.validate");
        const json::Value* valid = data.find("valid");
        check(valid != nullptr && valid->isBool() && valid->asBool(),
              "tlv.validate accepts a well-formed TLV");
        const json::Value* count = data.find("nodeCount");
        check(count != nullptr && count->asInt(-1) == 1, "tlv.validate counts one node");
        check(data.find("message") != nullptr, "tlv.validate explains its verdict");
    }
    {
        // Malformed input is a verdict here, not an error: tlv.validate exists
        // precisely to be asked about input that might be bad.
        const json::Value data =
            expectOk(session, "tlv.validate", args1("payload", json::Value("9F0206000000")),
                     "tlv.validate on a truncated TLV");
        const json::Value* valid = data.find("valid");
        check(valid != nullptr && valid->isBool() && !valid->asBool(),
              "tlv.validate reports a truncated TLV as invalid rather than failing");
    }
    {
        const json::Value data =
            expectOk(session, "tlv.toXml", args1("payload", json::Value("9F0206000000001000")),
                     "tlv.toXml");
        const std::string xml = dataString(data, "xml", "tlv.toXml");
        check(xml.find("9F02") != std::string::npos, "tlv.toXml names the tag", xml);

        const json::Value back =
            expectOk(session, "tlv.fromXml", args1("xml", json::Value(xml)), "tlv.fromXml");
        checkEqual(dataString(back, "hex", "tlv.fromXml"), "9F0206000000001000",
                   "tlv.toXml and tlv.fromXml round-trip");
    }
    {
        expectError(session, "tlv.fromXml", args1("xml", json::Value("<Tlv><Node")), "PARSE_FAILED",
                    "malformed TLV XML yields PARSE_FAILED");
    }

    // --- text ---------------------------------------------------------------
    std::printf("\n=== text ===\n");
    {
        const json::Value data =
            expectOk(session, "text.utf8ToHex", args1("text", json::Value("BufferX")),
                     "text.utf8ToHex");
        checkEqual(dataString(data, "hex", "text.utf8ToHex"), "42756666657258",
                   "text.utf8ToHex encodes ASCII");
    }
    {
        const json::Value data =
            expectOk(session, "text.hexToUtf8", args1("hex", json::Value("4275666665725822")),
                     "text.hexToUtf8");
        checkEqual(dataString(data, "text", "text.hexToUtf8"), "BufferX\"",
                   "text.hexToUtf8 decodes back to text");
    }
    {
        expectError(session, "text.hexToUtf8", args1("hex", json::Value("42756666657258Z")),
                    "BAD_HEX", "a non-hex argument yields BAD_HEX");
    }
    {
        // Windows-1256 (what the UI calls ANSI). "سلام" is D3 E1 C7 E3 there,
        // which is also the shortest proof the portable table is wired in.
        const std::string salam = "\xD8\xB3\xD9\x84\xD8\xA7\xD9\x85";   // UTF-8

        const json::Value hex =
            expectOk(session, "text.utf8ToAnsiHex", args1("text", json::Value(salam)),
                     "text.utf8ToAnsiHex");
        checkEqual(dataString(hex, "hex", "text.utf8ToAnsiHex"), "D3E1C7E3",
                   "text.utf8ToAnsiHex encodes Arabic to Windows-1256");

        const json::Value back =
            expectOk(session, "text.ansiHexToUtf8", args1("hex", json::Value("D3E1C7E3")),
                     "text.ansiHexToUtf8");
        checkEqual(dataString(back, "text", "text.ansiHexToUtf8"), salam,
                   "text.ansiHexToUtf8 decodes Windows-1256 back to UTF-8");

        // The byte-string forms carry the same bytes in a std::string rather
        // than in hex, so a round trip through both must be the identity.
        const json::Value encoded =
            expectOk(session, "text.utf8ToAnsi", args1("text", json::Value(salam)),
                     "text.utf8ToAnsi");
        const json::Value decoded = expectOk(
            session, "text.ansiToUtf8",
            args1("text", json::Value(dataString(encoded, "text", "text.utf8ToAnsi"))),
            "text.ansiToUtf8");
        checkEqual(dataString(decoded, "text", "text.ansiToUtf8"), salam,
                   "utf8ToAnsi followed by ansiToUtf8 is the identity");
    }
    {
        // IranSystem: the legacy ATM character set. Only the round trip is
        // asserted here -- the byte-level tables have their own differential
        // test in core/tests.
        const std::string salam = "\xD8\xB3\xD9\x84\xD8\xA7\xD9\x85";

        json::Value toIran = json::Value::object();
        toIran.set("text", json::Value(salam));
        toIran.set("convertNumbers", json::Value(true));

        const json::Value encoded =
            expectOk(session, "text.unicodeToIranSystem", toIran, "text.unicodeToIranSystem");
        const std::string iranHex = dataString(encoded, "hex", "text.unicodeToIranSystem");
        check(!iranHex.empty(), "text.unicodeToIranSystem produces bytes", iranHex);

        json::Value fromIran = json::Value::object();
        fromIran.set("payload", json::Value(iranHex));
        fromIran.set("inputHex", json::Value(true));
        const json::Value decoded =
            expectOk(session, "text.iranSystemToUnicode", fromIran, "text.iranSystemToUnicode");
        check(!dataString(decoded, "text", "text.iranSystemToUnicode").empty(),
              "text.iranSystemToUnicode returns text");

        // The *Text variants take and return UTF-8 rather than hex.
        const json::Value asText = expectOk(session, "text.utf8ToIranSystemText", toIran,
                                            "text.utf8ToIranSystemText");
        checkEqual(dataString(asText, "hex", "text.utf8ToIranSystemText"), iranHex,
                   "utf8ToIranSystemText agrees with unicodeToIranSystem on the bytes");
        expectOk(session, "text.iranSystemTextToUtf8",
                 args1("text", json::Value(dataString(asText, "text", "text.utf8ToIranSystemText"))),
                 "text.iranSystemTextToUtf8");

        // The ATM-engine variants use a different presentation-form mapping,
        // so they are exercised, not compared to the ones above.
        const json::Value atm = expectOk(session, "text.unicodeToAtmEngineIranSystem", toIran,
                                         "text.unicodeToAtmEngineIranSystem");
        json::Value fromAtm = json::Value::object();
        fromAtm.set("payload", json::Value(dataString(atm, "hex", "atm")));
        expectOk(session, "text.atmEngineIranSystemToUnicode", fromAtm,
                 "text.atmEngineIranSystemToUnicode");
    }
    {
        expectError(session, "text.utf8ToHex", object(), "BAD_ARGUMENT",
                    "a missing required argument yields BAD_ARGUMENT");
    }
    {
        expectError(session, "text.utf8ToHex", args1("text", json::Value(42)), "BAD_ARGUMENT",
                    "a wrong-typed argument yields BAD_ARGUMENT");
    }

    {
        json::Value args = object();
        args.set("tagHex", json::Value("01"));
        args.set("payload", json::Value("414243"));
        args.set("lengthBytes", json::Value(2));
        args.set("tagBytes", json::Value(1));
        const auto built = expectOk(session, "ltv.build", args, "LTV build through the ABI");
        checkEqual(dataString(built, "hex", "ltv.build"), "000301414243", "LTV golden wire");
        args.set("payload", json::Value("000301414243"));
        const auto parsed = expectOk(session, "ltv.parse", args, "LTV parse through the ABI");
        const auto* nodes = parsed.find("nodes");
        check(nodes && nodes->isArray() && nodes->size() == 1, "LTV record returned to the frontend");
        args.set("lengthBytes", json::Value(0));
        expectError(session, "ltv.parse", args, "BAD_ARGUMENT", "LTV rejects invalid widths at the ABI");
        args.set("lengthBytes", json::Value(2));
        args.set("payload", json::Value("000A0141"));
        expectError(session, "ltv.parse", args, "DECODE_FAILED", "LTV rejects truncated records at the ABI");
    }

    bufferx_close(session);
    // Closing NULL must be a no-op rather than a fault on the default session.
    bufferx_close(nullptr);
    check(true, "bufferx_close accepts NULL");

    std::printf("\n=== RESULT: %s (%d failures) ===\n", failures == 0 ? "ALL PASS" : "FAILURES",
                failures);
    return failures == 0 ? 0 : 1;
}
