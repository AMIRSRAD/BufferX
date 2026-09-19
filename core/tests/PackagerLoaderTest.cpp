// Verifies the dependency-free XML reader that replaced QXmlStreamReader,
// loading the real data/packagers.xml plus the malformed cases that must fail
// loudly rather than decode wrongly.

#include <cstdio>
#include <fstream>
#include <sstream>
#include <string>

#include "bufferx/PackagerLoader.h"
#include "bufferx/XmlLite.h"

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

} // namespace

int main(int argc, char** argv) {
    const std::string packagersPath =
        argc > 1 ? argv[1] : std::string(BUFFERX_SOURCE_DIR) + "/data/packagers.xml";

    std::printf("=== Real packager definitions (%s) ===\n", packagersPath.c_str());
    const std::string xml = readFile(packagersPath);
    check(!xml.empty(), "packagers.xml is readable", std::to_string(xml.size()) + " bytes");

    const PackagerLoadResult result = PackagerLoader::loadFromXml(xml);
    check(result.ok, "loads without error", result.error);
    check(result.packagers.size() == 32, "found 32 packagers",
          std::to_string(result.packagers.size()));

    // Spot-check the first definition against the file's literal attributes.
    const Packager* slm = nullptr;
    for (const Packager& p : result.packagers) {
        if (p.name == "SLM") {
            slm = &p;
            break;
        }
    }
    check(slm != nullptr, "packager 'SLM' present");
    if (slm != nullptr) {
        check(slm->macMethod == "FULL", "SLM MacMethod == FULL", slm->macMethod);
        check(slm->macSize == 16, "SLM MacSize == 16", std::to_string(slm->macSize));
        check(slm->bitmapIndex == 1, "SLM BitmapIndex == 1", std::to_string(slm->bitmapIndex));
        check(slm->secondPartBitmap == 64, "SLM SecondPartBitmap == 64",
              std::to_string(slm->secondPartBitmap));
        check(slm->fieldCount == 128, "SLM FieldCount == 128", std::to_string(slm->fieldCount));
        check(slm->lenFormat == "SLM", "SLM LenFormat == SLM", slm->lenFormat);
        check(slm->lenLen == 4, "SLM LenLen == 4", std::to_string(slm->lenLen));

        const auto field2 = slm->fields.find(2);
        check(field2 != slm->fields.end(), "SLM has field 2");
        if (field2 != slm->fields.end()) {
            check(field2->second.sourceType == "IFA_LLNUM", "field 2 type IFA_LLNUM",
                  field2->second.sourceType);
            check(field2->second.length == 19, "field 2 length 19",
                  std::to_string(field2->second.length));
            check(field2->second.desc == "PAN - PRIMARY ACCOUNT NUMBER", "field 2 description",
                  field2->second.desc);
            // `Flags ="00"` in the source file has a space before '='.
            check(field2->second.flags == "00", "field 2 flags parsed despite space before '='",
                  field2->second.flags);
            check(field2->second.variable, "field 2 is variable length");
        }
    }

    std::printf("\n=== XML subset support ===\n");
    {
        const auto parsed = xmllite::parse(
            "<?xml version=\"1.0\"?>\n<!-- a comment -->\n"
            "<Root a='single' b=\"double\" c = \"spaced\">"
            "<Child>text &amp; more &#65;</Child><Empty/></Root>");
        check(parsed.ok, "prolog, comment, both quote styles, entities", parsed.error);
        if (parsed.ok) {
            check(parsed.root.attributeOr("a") == "single", "single-quoted attribute");
            check(parsed.root.attributeOr("c") == "spaced", "whitespace around '='");
            check(parsed.root.children.size() == 2, "two children",
                  std::to_string(parsed.root.children.size()));
            if (parsed.root.children.size() == 2) {
                check(parsed.root.children[0].text == "text & more A", "entities decoded",
                      parsed.root.children[0].text);
            }
        }
    }
    {
        const auto parsed = xmllite::parse("<A><B></A>");
        check(!parsed.ok, "mismatched closing tag rejected", parsed.error);
    }
    {
        const auto parsed = xmllite::parse("<A x=\"&bogus;\"/>");
        check(!parsed.ok, "unknown entity rejected rather than passed through", parsed.error);
    }
    {
        const auto parsed = xmllite::parse("<A x=\"unterminated />");
        check(!parsed.ok, "unterminated attribute rejected", parsed.error);
    }

    std::printf("\n=== Loader error handling ===\n");
    {
        const auto bad = PackagerLoader::loadFromXml("<Packagers><Packager/></Packagers>");
        check(!bad.ok && bad.error.find("Name") != std::string::npos,
              "missing required Name reported", bad.error);
    }
    {
        const auto bad = PackagerLoader::loadFromXml(
            "<Packagers><Packager Name=\"X\" MacSize=\"abc\"/></Packagers>");
        check(!bad.ok && bad.error.find("integer") != std::string::npos,
              "non-numeric integer attribute reported", bad.error);
    }
    {
        const auto bad = PackagerLoader::loadFromXml("<Packagers/>");
        check(!bad.ok && bad.error.find("No packagers") != std::string::npos,
              "empty document reported", bad.error);
    }
    {
        // Defaults apply when optional attributes are absent.
        const auto ok = PackagerLoader::loadFromXml("<Packagers><Packager Name=\"D\"/></Packagers>");
        check(ok.ok, "minimal packager loads", ok.error);
        if (ok.ok) {
            check(ok.packagers[0].bitmapIndex == 1 && ok.packagers[0].fieldCount == 64,
                  "documented defaults applied");
        }
    }

    std::printf("\n=== RESULT: %s (%d failures) ===\n", failures == 0 ? "ALL PASS" : "FAILURES",
                failures);
    return failures == 0 ? 0 : 1;
}
