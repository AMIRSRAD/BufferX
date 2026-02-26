#pragma once

#include <string>
#include <vector>

#include "Packager.h"

struct PackagerLoadResult {
    bool ok = false;
    std::string error;
    std::vector<Packager> packagers;
};

class PackagerLoader {
public:
    static PackagerLoadResult loadFromXml(const std::string& xml);
};
