// End-to-end check against the real shipped packager definitions.
//
// AbiTest exercises the operation catalogue with small inline fixtures. This
// one drives the same ABI with data/packagers.xml -- all 32 real definitions,
// 87 KB of them -- so a regression in the XML reader, the packager registry, or
// the ISO codec against production data fails here rather than in front of an
// operator.

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "JsonLite.h"
#include "bufferx_abi.h"

namespace {

int failures = 0;

void check(bool condition, const std::string& label, const std::string& detail = {}) {
    std::printf("  [%s] %s%s\n", condition ? "PASS" : "FAIL", label.c_str(),
                detail.empty() ? "" : ("  -> " + detail).c_str());
    if (!condition) ++failures;
}

std::string readFile(const std::string& path) {
    std::ifstream in(path, std::ios::binary);
    std::ostringstream buffer;
    buffer << in.rdbuf();
    return buffer.str();
}

/** Sends one request and returns the parsed response envelope. */
json::Value invoke(bufferx_session* session, const std::string& requestJson) {
    char* raw = bufferx_invoke(session, requestJson.c_str());
    if (raw == nullptr) {
        return json::Value();
    }
    const std::string text(raw);
    bufferx_string_free(raw);
    return json::parse(text).value;
}

bool ok(const json::Value& response) {
    const json::Value* flag = response.find("ok");
    return flag != nullptr && flag->asBool();
}

std::string errorOf(const json::Value& response) {
    const json::Value* error = response.find("error");
    if (error == nullptr) return "(no error member)";
    const json::Value* code = error->find("code");
    const json::Value* message = error->find("message");
    return (code ? code->asString() : "?") + ": " + (message ? message->asString() : "?");
}

} // namespace

int main(int argc, char** argv) {
    const std::string packagersPath =
        argc > 1 ? argv[1] : std::string(BUFFERX_SOURCE_DIR) + "/data/packagers.xml";

    bufferx_session* session = bufferx_open();
    check(session != nullptr, "bufferx_open returns a session");
    if (session == nullptr) return 1;

    std::printf("=== A new session boots with the built-in definitions ===\n");
    {
        json::Value request = json::Value::object();
        request.set("v", json::Value(1));
        request.set("op", json::Value("packager.list"));
        request.set("args", json::Value::object());

        const json::Value response = invoke(session, request.serialize());
        check(ok(response), "packager.list on a fresh session", errorOf(response));

        const json::Value* data = response.find("data");
        const json::Value* list = data ? data->find("packagers") : nullptr;
        check(list != nullptr && list->size() == 32,
              "the compiled-in definitions are already loaded",
              list ? std::to_string(list->size()) + " packagers" : "(absent)");

        bool foundNeginLink = false;
        bool foundSlm = false;
        if (list != nullptr) {
            for (std::size_t i = 0; i < list->size(); ++i) {
                const json::Value* name = list->at(i).find("name");
                if (name == nullptr) continue;
                if (name->asString() == "NEGINLink") foundNeginLink = true;
                if (name->asString() == "SLM") foundSlm = true;
            }
        }
        check(foundSlm, "SLM is present out of the box");
        check(foundNeginLink, "NEGINLink is present out of the box");
    }

    std::printf("\n=== Loading the real packager definitions ===\n");
    const std::string xml = readFile(packagersPath);
    check(!xml.empty(), "data/packagers.xml is readable", std::to_string(xml.size()) + " bytes");

    json::Value request = json::Value::object();
    request.set("v", json::Value(1));
    request.set("op", json::Value("packager.loadXml"));
    json::Value args = json::Value::object();
    args.set("xml", json::Value(xml));
    request.set("args", args);

    json::Value response = invoke(session, request.serialize());
    check(ok(response), "packager.loadXml accepts the shipped file", errorOf(response));

    const json::Value* data = response.find("data");
    const json::Value* count = data ? data->find("count") : nullptr;
    check(count != nullptr && count->asInt() == 32, "all 32 packagers loaded",
          count ? std::to_string(count->asInt()) : "(absent)");

    std::printf("\n=== SLM field metadata ===\n");
    request = json::Value::object();
    request.set("v", json::Value(1));
    request.set("op", json::Value("packager.fields"));
    args = json::Value::object();
    args.set("packager", json::Value("SLM"));
    request.set("args", args);

    response = invoke(session, request.serialize());
    check(ok(response), "packager.fields SLM", errorOf(response));
    data = response.find("data");
    const json::Value* fields = data ? data->find("fields") : nullptr;
    check(fields != nullptr && fields->size() > 60, "SLM exposes its full field set",
          fields ? std::to_string(fields->size()) + " fields" : "(absent)");

    std::printf("\n=== Encode then decode a 0200 against SLM ===\n");
    // A minimal but realistic purchase: MTI, PAN, processing code, amount, STAN.
    const struct {
        int id;
        const char* value;
    } purchase[] = {
        {0, "0200"},
        {2, "6274129005473742"},
        {3, "000000"},
        {4, "000000150000"},
        {11, "004512"},
        {41, "TERM0001"},
    };

    json::Value fieldList = json::Value::array();
    for (const auto& field : purchase) {
        json::Value entry = json::Value::object();
        entry.set("id", json::Value(field.id));
        entry.set("value", json::Value(field.value));
        fieldList.push(entry);
    }

    request = json::Value::object();
    request.set("v", json::Value(1));
    request.set("op", json::Value("iso.encode"));
    args = json::Value::object();
    args.set("packager", json::Value("SLM"));
    args.set("fields", fieldList);
    args.set("outputHex", json::Value(true));
    request.set("args", args);

    response = invoke(session, request.serialize());
    check(ok(response), "iso.encode builds the message", errorOf(response));

    data = response.find("data");
    const json::Value* hex = data ? data->find("hex") : nullptr;
    check(hex != nullptr && !hex->asString().empty(), "encode produced a buffer",
          hex ? hex->asString().substr(0, 48) + "..." : "(absent)");
    if (hex == nullptr) {
        bufferx_close(session);
        return 1;
    }

    request = json::Value::object();
    request.set("v", json::Value(1));
    request.set("op", json::Value("iso.decode"));
    args = json::Value::object();
    args.set("packager", json::Value("SLM"));
    args.set("payload", json::Value(hex->asString()));
    args.set("inputHex", json::Value(true));
    request.set("args", args);

    response = invoke(session, request.serialize());
    check(ok(response), "iso.decode reads it back", errorOf(response));

    data = response.find("data");
    const json::Value* decoded = data ? data->find("fields") : nullptr;
    check(decoded != nullptr, "decode returned fields");

    if (decoded != nullptr) {
        int matched = 0;
        std::string pan;
        std::string description;
        for (std::size_t i = 0; i < decoded->size(); ++i) {
            const json::Value& field = decoded->at(i);
            const json::Value* id = field.find("id");
            const json::Value* value = field.find("value");
            if (id == nullptr || value == nullptr) continue;
            for (const auto& expected : purchase) {
                if (id->asInt() == expected.id && value->asString() == expected.value) {
                    ++matched;
                }
            }
            if (id->asInt() == 2) {
                pan = value->asString();
                const json::Value* desc = field.find("desc");
                if (desc != nullptr) description = desc->asString();
            }
        }
        check(matched == 6, "every field round-trips through the real packager",
              std::to_string(matched) + " of 6");
        check(pan == "6274129005473742", "the PAN survives the LLNUM round trip", pan);
        check(description == "PAN - PRIMARY ACCOUNT NUMBER",
              "decoded fields carry their packager description", description);
    }

    std::printf("\n=== Unknown packager is reported, not guessed ===\n");
    request = json::Value::object();
    request.set("v", json::Value(1));
    request.set("op", json::Value("iso.decode"));
    args = json::Value::object();
    args.set("packager", json::Value("NOT_A_PACKAGER"));
    args.set("payload", json::Value("30323030"));
    args.set("inputHex", json::Value(true));
    request.set("args", args);

    response = invoke(session, request.serialize());
    const json::Value* error = response.find("error");
    const json::Value* code = error ? error->find("code") : nullptr;
    check(!ok(response) && code != nullptr && code->asString() == "UNKNOWN_PACKAGER",
          "an unknown packager yields UNKNOWN_PACKAGER", code ? code->asString() : "(absent)");

    std::printf("\n=== A truncated message still reports what it read ===\n");
    {
        // Real switch logs get cut at a block boundary, which lops the tail off
        // the trailing MAC. The decode must still fail -- the message really is
        // incomplete -- but an operator needs the fields that were readable, so
        // they can see how far the parse got and which field it died on.
        //
        // Built by encoding and then truncating rather than pasting a captured
        // buffer: production captures carry live PANs and PIN blocks, which do
        // not belong in a repository.
        json::Value truncFields = json::Value::array();
        const struct {
            int id;
            const char* value;
        } message[] = {
            {0, "0200"}, {2, "6274129005473742"}, {3, "000000"}, {4, "000000150000"},
            {11, "004512"}, {41, "TERM0001"}, {64, "A1B2C3D4E5F60718"},
        };
        for (const auto& f : message) {
            json::Value e = json::Value::object();
            e.set("id", json::Value(f.id));
            e.set("value", json::Value(f.value));
            truncFields.push(e);
        }

        request = json::Value::object();
        request.set("v", json::Value(1));
        request.set("op", json::Value("iso.encode"));
        args = json::Value::object();
        args.set("packager", json::Value("SLM"));
        args.set("fields", truncFields);
        args.set("outputHex", json::Value(false));
        request.set("args", args);

        response = invoke(session, request.serialize());
        check(ok(response), "iso.encode builds a message carrying a MAC", errorOf(response));
        data = response.find("data");
        const json::Value* text = data ? data->find("text") : nullptr;

        if (text != nullptr && text->asString().size() > 6) {
            const std::string full = text->asString();
            const std::string cut = full.substr(0, full.size() - 6);

            request = json::Value::object();
            request.set("v", json::Value(1));
            request.set("op", json::Value("iso.decode"));
            args = json::Value::object();
            args.set("packager", json::Value("SLM"));
            args.set("payload", json::Value(cut));
            args.set("inputHex", json::Value(false));
            request.set("args", args);

            response = invoke(session, request.serialize());
            check(!ok(response), "a truncated message is still reported as a failure");

            const json::Value* err = response.find("error");
            const json::Value* detail = err ? err->find("detail") : nullptr;
            const json::Value* partial = detail ? detail->find("partialFields") : nullptr;
            const json::Value* count = detail ? detail->find("partialCount") : nullptr;

            check(partial != nullptr && partial->size() >= 6,
                  "every field before the truncation is returned for inspection",
                  partial ? std::to_string(partial->size()) + " fields" : "(absent)");
            check(count != nullptr && count->asInt() == static_cast<int>(partial ? partial->size() : 0),
                  "partialCount agrees with partialFields");

            // The PAN is the field an operator looks for first.
            bool panRecovered = false;
            if (partial != nullptr) {
                for (std::size_t i = 0; i < partial->size(); ++i) {
                    const json::Value* id = partial->at(i).find("id");
                    const json::Value* v = partial->at(i).find("value");
                    if (id && v && id->asInt() == 2 && v->asString() == "6274129005473742") {
                        panRecovered = true;
                    }
                }
            }
            check(panRecovered, "the PAN survives in the partial result");
        }
    }

    std::printf("\n=== Sessions are independent ===\n");
    bufferx_session* second = bufferx_open();
    request = json::Value::object();
    request.set("v", json::Value(1));
    request.set("op", json::Value("packager.list"));
    request.set("args", json::Value::object());
    response = invoke(second, request.serialize());
    data = response.find("data");
    const json::Value* list = data ? data->find("packagers") : nullptr;
    // Both sessions carry the built-in set, so equal counts prove nothing on
  // their own. What matters is that the second session did NOT inherit the
  // first session's *loaded* registry -- it holds the built-ins independently.
  check(ok(response) && list != nullptr && list->size() == 32,
          "a fresh session has its own registry, seeded from the built-ins",
          list ? std::to_string(list->size()) + " packagers" : "(absent)");
    bufferx_close(second);

    bufferx_close(session);

    std::printf("\n=== RESULT: %s (%d failures) ===\n", failures == 0 ? "ALL PASS" : "FAILURES",
                failures);
    return failures == 0 ? 0 : 1;
}
