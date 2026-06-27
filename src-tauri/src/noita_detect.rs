//! Locate the player's Noita install (and therefore the snapshot.json the live bridge
//! watches) without relying on the webview's fs scope. plugin-fs can't enumerate arbitrary
//! drives ahead of time to put in `fs:scope`, and forbids `..` traversal — so this runs in
//! Rust (std::fs, no scope wall) and is the project's first Tauri command. It parses Steam's
//! libraryfolders.vdf to find every library, then probes each for steamapps/common/Noita.
//!
//! Cross-platform: seeds the known Steam roots per OS, then expands with the library paths the
//! vdf lists (covering other drives on Windows / extra libraries on Linux). Infallible by
//! design — returns Option fields + the list of paths it searched, so the TS side always has a
//! result to fall back from and the diagnostic line can show what was checked.

use std::collections::HashSet;
use std::path::PathBuf;

#[derive(serde::Serialize)]
pub struct NoitaDetection {
    /// Expected snapshot path (`<install>/snapshot.json`) when the install dir exists, even if
    /// the file isn't written yet (the watcher waits for it). None if Noita wasn't found.
    pub snapshot_path: Option<String>,
    pub install_dir: Option<String>,
    /// Every snapshot path probed — feeds the live-status line when nothing is found.
    pub searched: Vec<String>,
}

/// Extract every double-quoted token on a line, honoring Valve's `\\` and `\"` escapes while
/// keeping any other backslash literal (some installs store Windows paths unescaped).
fn quoted_tokens(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '"' {
            continue;
        }
        let mut tok = String::new();
        while let Some(d) = chars.next() {
            match d {
                '\\' => match chars.peek() {
                    Some('\\') => {
                        tok.push('\\');
                        chars.next();
                    }
                    Some('"') => {
                        tok.push('"');
                        chars.next();
                    }
                    _ => tok.push('\\'),
                },
                '"' => break,
                _ => tok.push(d),
            }
        }
        out.push(tok);
    }
    out
}

/// Parse libraryfolders.vdf into the list of Steam library root paths. Handles the modern
/// format (`"path" "<dir>"`) and the classic format (numeric key → path value), while skipping
/// the `apps` appid→size entries (numeric key but a non-path value).
pub fn parse_library_paths(vdf: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in vdf.lines() {
        let tokens = quoted_tokens(line);
        if tokens.len() < 2 {
            continue;
        }
        let (key, val) = (&tokens[0], &tokens[1]);
        let is_path_key = key == "path" || (!key.is_empty() && key.chars().all(|c| c.is_ascii_digit()));
        // The value must actually look like a path, which excludes appid→size pairs.
        if is_path_key && (val.contains('/') || val.contains('\\')) {
            out.push(val.clone());
        }
    }
    out
}

/// Known Steam install roots to seed the search, per OS. On Windows the default root's vdf
/// reveals libraries on other drives, so seeding the default is enough for the common case.
fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(windows)]
    {
        if let Some(pf) = std::env::var_os("ProgramFiles(x86)") {
            roots.push(PathBuf::from(pf).join("Steam"));
        }
        roots.push(PathBuf::from("C:\\Program Files (x86)\\Steam"));
        roots.push(PathBuf::from("C:\\Program Files\\Steam"));
    }
    #[cfg(not(windows))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            roots.push(home.join(".local/share/Steam")); // native Steam (Proton lives here too)
            roots.push(home.join(".steam/steam"));
            roots.push(home.join(".steam/root"));
            roots.push(home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam")); // Flatpak
        }
    }
    roots
}

/// All candidate library roots: the seeded Steam roots plus every path their libraryfolders.vdf
/// lists, de-duplicated while preserving order.
fn library_roots() -> Vec<PathBuf> {
    let seeds = steam_roots();
    let mut libs: Vec<PathBuf> = Vec::new();
    for root in &seeds {
        let vdf = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(text) = std::fs::read_to_string(&vdf) {
            for p in parse_library_paths(&text) {
                libs.push(PathBuf::from(p));
            }
        }
    }
    libs.extend(seeds); // the Steam roots are themselves libraries
    let mut seen = HashSet::new();
    libs.retain(|p| seen.insert(p.clone()));
    libs
}

/// Detect the Noita install + snapshot path. Probes `<lib>/steamapps/common/Noita` for each
/// candidate library and returns the first that exists. Never errors (None fields on miss).
#[tauri::command]
pub fn detect_noita() -> NoitaDetection {
    let mut searched = Vec::new();
    for lib in library_roots() {
        let install = lib.join("steamapps").join("common").join("Noita");
        let snapshot = install.join("snapshot.json");
        searched.push(snapshot.to_string_lossy().to_string());
        if install.is_dir() {
            return NoitaDetection {
                snapshot_path: Some(snapshot.to_string_lossy().to_string()),
                install_dir: Some(install.to_string_lossy().to_string()),
                searched,
            };
        }
    }
    NoitaDetection { snapshot_path: None, install_dir: None, searched }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_modern_linux_multi_root_and_skips_appids() {
        let vdf = r#""libraryfolders"
{
	"0"
	{
		"path"		"/home/u/.local/share/Steam"
		"apps"
		{
			"881100"		"1639174567"
		}
	}
	"1"
	{
		"path"		"/mnt/games/SteamLibrary"
	}
}
"#;
        assert_eq!(
            parse_library_paths(vdf),
            vec![
                "/home/u/.local/share/Steam".to_string(),
                "/mnt/games/SteamLibrary".to_string(),
            ]
        );
    }

    #[test]
    fn parses_classic_windows_with_escaped_backslashes() {
        let vdf = r#""LibraryFolders"
{
	"TimeNextStatsReport"		"123456"
	"ContentStatsID"		"789"
	"1"		"D:\\SteamLibrary"
	"2"		"E:\\Games\\Steam"
}
"#;
        // \\ in the vdf unescapes to a single backslash.
        assert_eq!(
            parse_library_paths(vdf),
            vec!["D:\\SteamLibrary".to_string(), "E:\\Games\\Steam".to_string()]
        );
    }

    #[test]
    fn keeps_unescaped_windows_backslashes_too() {
        // Some installs store paths with single backslashes; don't drop them.
        let vdf = "\t\"0\"\t\t\"D:\\Steam\"\n";
        assert_eq!(parse_library_paths(vdf), vec!["D:\\Steam".to_string()]);
    }

    #[test]
    fn malformed_or_empty_vdf_yields_nothing_without_panicking() {
        assert!(parse_library_paths("").is_empty());
        assert!(parse_library_paths("not a vdf at all").is_empty());
        assert!(parse_library_paths("\"path\"\t\t\"").is_empty()); // unterminated value
        assert!(parse_library_paths("\"someKey\"\t\t\"not-a-path\"").is_empty());
    }
}
