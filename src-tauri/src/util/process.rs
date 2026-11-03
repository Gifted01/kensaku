use std::process::Command;

/// Prevents a console window from flashing on screen when spawning a
/// console application (tesseract, pdftoppm, external extractors) on
/// Windows. On other platforms this is a no-op.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}
/// A spelling of `path` that a narrow-character (ANSI) Windows program can
/// open.
///
/// Rust starts child processes with a UTF-16 command line, but programs with
/// a classic `main(argc, argv)` such as Tesseract receive `argv` converted to
/// the system ANSI code page. A Cyrillic path then survives only on a Russian
/// code page (1251), and characters outside that code page — or any Cyrillic
/// on an English Windows, e.g. `C:\Users\Владимир\...` — turn into `?` and the
/// file cannot be opened. The 8.3 short name (`C:\Users\5C46~1\...`) is pure
/// ASCII and opens the same file.
///
/// Returns `None` when the path is not ASCII-safe and no ASCII short name
/// exists (8.3 names disabled on that volume); callers should then avoid
/// passing the path on the command line. On other platforms the path is
/// returned unchanged.
pub fn ansi_safe_path(path: &std::path::Path) -> Option<std::path::PathBuf> {
    let is_ascii = path.as_os_str().to_str().is_some_and(|s| s.is_ascii());
    if is_ascii || !cfg!(windows) {
        return Some(path.to_path_buf());
    }
    short_path(path).filter(|p| p.as_os_str().to_str().is_some_and(|s| s.is_ascii()))
}

#[cfg(windows)]
fn short_path(path: &std::path::Path) -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use windows::Win32::Storage::FileSystem::GetShortPathNameW;
    use windows::core::PCWSTR;

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let needed = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), None) };
    if needed == 0 {
        return None;
    }
    let mut buf = vec![0u16; needed as usize];
    let written = unsafe { GetShortPathNameW(PCWSTR(wide.as_ptr()), Some(&mut buf)) };
    if written == 0 || written as usize >= buf.len() {
        return None;
    }
    buf.truncate(written as usize);
    Some(std::path::PathBuf::from(std::ffi::OsString::from_wide(
        &buf,
    )))
}

#[cfg(not(windows))]
fn short_path(_path: &std::path::Path) -> Option<std::path::PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ascii_and_non_windows_paths_pass_through() {
        let p = std::path::Path::new("/tmp/report.png");
        assert_eq!(ansi_safe_path(p).as_deref(), Some(p));
        let ru = std::path::Path::new("/home/Владимир/Скриншоты/ошибка.png");
        if !cfg!(windows) {
            assert_eq!(ansi_safe_path(ru).as_deref(), Some(ru));
        }
    }
}
