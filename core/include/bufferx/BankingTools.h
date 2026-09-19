#pragma once

#include <string>

struct BankingToolResult {
    bool ok = false;
    std::string error;
    std::string output;
};

namespace bankingtools {

BankingToolResult run(const std::string& operation,
                      const std::string& input,
                      const std::string& secondary,
                      int parameter);

} // namespace bankingtools
