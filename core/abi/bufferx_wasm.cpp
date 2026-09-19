// Emscripten entry translation unit.
//
// BufferXAbi is a static archive, so the linker will not pull in symbols that
// nothing references -- listing them in EXPORTED_FUNCTIONS is not enough on its
// own. This file takes their addresses to force them in, and gives the module
// the `main` Emscripten expects.
//
// There is no logic here. The engine is entirely in bufferx_abi.cpp; the browser
// and the desktop host run the same code through the same entry points.

#include "bufferx_abi.h"

#include <cstddef>

namespace {

// Referencing each export keeps it in the link. `volatile` stops the optimiser
// from concluding the array is dead and dropping it again at -O3.
void* volatile kKeepAlive[] = {
    reinterpret_cast<void*>(&bufferx_open),
    reinterpret_cast<void*>(&bufferx_close),
    reinterpret_cast<void*>(&bufferx_invoke),
    reinterpret_cast<void*>(&bufferx_string_free),
    reinterpret_cast<void*>(&bufferx_version),
};

} // namespace

int main() {
    // EXIT_RUNTIME=0, so returning here leaves the module loaded and callable.
    // Touch the table so it survives to the final binary.
    (void)kKeepAlive[0];
    return 0;
}
