fn main() {
    // The Windows desktop library exposes no C ABI. MinGW otherwise tries to
    // export every Rust symbol, exceeding PE's 16-bit export ordinal limit.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        println!("cargo:rustc-cdylib-link-arg=-Wl,--exclude-all-symbols");
    }
    tauri_build::build()
}
