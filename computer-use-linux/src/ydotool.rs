use std::{
    env,
    ffi::OsStr,
    fs, io,
    os::unix::{
        ffi::OsStrExt,
        fs::{DirBuilderExt, MetadataExt, PermissionsExt},
        net::UnixDatagram,
    },
    path::{Path, PathBuf},
    process::{self, Command, Stdio},
    sync::OnceLock,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CliGeneration {
    RawEvents,
    LegacyNamed,
}

const MAX_UNIX_SOCKET_PATH_BYTES: usize = 107;
const PROBE_DIRECTORY_ATTEMPTS: usize = 8;
const UNSUPPORTED_MESSAGE: &str = "unsupported ydotool CLI; Computer Use requires ydotool 1.0.2 or newer with raw key events, wheel movement, stdin typing, and absolute mouse movement";

struct ProbeSocket {
    _socket: UnixDatagram,
    directory: PathBuf,
    path: PathBuf,
}

impl ProbeSocket {
    fn bind_with(runtime_dir: Option<&OsStr>, temp_dir: &Path) -> Result<Self, String> {
        let uid = unsafe { libc::geteuid() };
        let mut failures = Vec::new();
        for base in probe_socket_bases(runtime_dir, temp_dir) {
            if let Err(error) = validate_probe_base(&base, uid) {
                failures.push(format!("{}: {error}", base.display()));
                continue;
            }
            match Self::bind_in(&base) {
                Ok(socket) => return Ok(socket),
                Err(error) => failures.push(format!("{}: {error}", base.display())),
            }
        }

        let detail = if failures.is_empty() {
            "no candidate runtime directory was available".to_string()
        } else {
            failures.join("; ")
        };
        Err(format!(
            "failed to bind isolated ydotool probe socket: {detail}"
        ))
    }

    fn bind_in(base: &Path) -> io::Result<Self> {
        let sample_path = base.join(format!(
            ".codex-ydotool-probe-{}-0000000000000000/s",
            process::id()
        ));
        if !unix_socket_path_fits(&sample_path) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "probe socket path is too long",
            ));
        }

        for _ in 0..PROBE_DIRECTORY_ATTEMPTS {
            let nonce = random_hex(8)?;
            let directory = base.join(format!(".codex-ydotool-probe-{}-{nonce}", process::id()));
            let path = directory.join("s");
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            match builder.create(&directory) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(error),
            }
            if let Err(error) = fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)) {
                let _ = fs::remove_dir(&directory);
                return Err(error);
            }
            match UnixDatagram::bind(&path) {
                Ok(socket) => {
                    return Ok(Self {
                        _socket: socket,
                        directory,
                        path,
                    });
                }
                Err(error) => {
                    let _ = fs::remove_file(&path);
                    let _ = fs::remove_dir(&directory);
                    return Err(error);
                }
            }
        }

        Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "could not allocate a unique probe directory",
        ))
    }
}

impl Drop for ProbeSocket {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
        let _ = fs::remove_dir(&self.directory);
    }
}

pub(crate) fn ensure_supported() -> Result<String, String> {
    static RESULT: OnceLock<Result<String, String>> = OnceLock::new();
    RESULT.get_or_init(probe).clone()
}

fn probe() -> Result<String, String> {
    let runtime_dir = env::var_os("XDG_RUNTIME_DIR");
    probe_with(
        Path::new("ydotool"),
        runtime_dir.as_deref(),
        &env::temp_dir(),
    )
}

fn probe_with(
    ydotool_path: &Path,
    runtime_dir: Option<&OsStr>,
    temp_dir: &Path,
) -> Result<String, String> {
    let mut output_text = String::new();
    for argument in ["help", "--help"] {
        let output = Command::new(ydotool_path)
            .arg(argument)
            .output()
            .map_err(|error| format!("failed to run ydotool: {error}"))?;
        output_text.push_str(&String::from_utf8_lossy(&output.stdout));
        output_text.push_str(&String::from_utf8_lossy(&output.stderr));
        if let Some(generation) = classify_help(&output_text) {
            return match generation {
                CliGeneration::RawEvents => {
                    probe_raw_semantics(ydotool_path, runtime_dir, temp_dir)
                        .map(|()| "compatible raw-event CLI detected".to_string())
                }
                CliGeneration::LegacyNamed => Err(UNSUPPORTED_MESSAGE.to_string()),
            };
        }
    }
    Err("unrecognized ydotool CLI; Computer Use requires ydotool 1.0.2 or newer".to_string())
}

fn probe_raw_semantics(
    ydotool_path: &Path,
    runtime_dir: Option<&OsStr>,
    temp_dir: &Path,
) -> Result<(), String> {
    let socket = ProbeSocket::bind_with(runtime_dir, temp_dir)?;
    let wheel = run_probe_command(
        ydotool_path,
        &socket.path,
        &["mousemove", "--wheel", "--", "0", "0"],
        None,
    )?;
    let type_from_stdin = run_probe_command(
        ydotool_path,
        &socket.path,
        &["type", "--file", "-"],
        Some(Path::new("/proc/self/fd")),
    )?;

    if raw_semantic_probes_succeeded(
        wheel.status.success(),
        &wheel.stderr,
        type_from_stdin.status.success(),
        &type_from_stdin.stderr,
    ) {
        Ok(())
    } else {
        Err(UNSUPPORTED_MESSAGE.to_string())
    }
}

fn run_probe_command(
    ydotool_path: &Path,
    socket_path: &Path,
    args: &[&str],
    current_dir: Option<&Path>,
) -> Result<std::process::Output, String> {
    let mut command = Command::new(ydotool_path);
    command
        .args(args)
        .env("YDOTOOL_SOCKET", socket_path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(current_dir) = current_dir {
        command.current_dir(current_dir);
    }
    command
        .output()
        .map_err(|error| format!("failed to run ydotool capability probe: {error}"))
}

fn probe_socket_bases(runtime_dir: Option<&OsStr>, temp_dir: &Path) -> Vec<PathBuf> {
    let mut bases = Vec::new();
    if let Some(runtime_dir) = runtime_dir {
        push_unique_path(&mut bases, PathBuf::from(runtime_dir));
    }
    push_unique_path(&mut bases, temp_dir.to_path_buf());
    push_unique_path(&mut bases, PathBuf::from("/tmp"));
    bases
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|candidate| candidate == &path) {
        paths.push(path);
    }
}

fn validate_probe_base(path: &Path, uid: libc::uid_t) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("path is not absolute".to_string());
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("path is not a real directory".to_string());
    }
    let mode = metadata.permissions().mode();
    let user_owned_safe_directory = metadata.uid() == uid && mode & 0o022 == 0;
    let root_owned_sticky_directory = metadata.uid() == 0 && mode & libc::S_ISVTX != 0;
    if !user_owned_safe_directory && !root_owned_sticky_directory {
        return Err("directory is not private or root-owned sticky".to_string());
    }
    Ok(())
}

fn random_hex(byte_count: usize) -> io::Result<String> {
    let mut bytes = vec![0_u8; byte_count];
    getrandom::fill(&mut bytes).map_err(io::Error::other)?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(byte_count * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    Ok(output)
}

fn unix_socket_path_fits(path: &Path) -> bool {
    path.as_os_str().as_bytes().len() <= MAX_UNIX_SOCKET_PATH_BYTES
}

fn raw_semantic_probes_succeeded(
    wheel_success: bool,
    wheel_stderr: &[u8],
    type_success: bool,
    type_stderr: &[u8],
) -> bool {
    wheel_success
        && cli_error(wheel_stderr).is_none()
        && type_success
        && cli_error(type_stderr).is_none()
}

pub(crate) fn classify_help(help: &str) -> Option<CliGeneration> {
    let commands = help
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    let required_raw_commands = ["click", "mousemove", "type", "key", "debug"];
    if required_raw_commands
        .iter()
        .all(|command| commands.contains(command))
    {
        Some(CliGeneration::RawEvents)
    } else if commands.contains(&"recorder") {
        Some(CliGeneration::LegacyNamed)
    } else {
        None
    }
}

pub(crate) fn cli_error(stderr: &[u8]) -> Option<String> {
    let detail = String::from_utf8_lossy(stderr).trim().to_string();
    let normalized = detail.to_ascii_lowercase();
    [
        "unrecognised option",
        "unrecognized option",
        "unknown option",
        "invalid option",
        "unknown command",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
    .then_some(detail)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            let path = env::temp_dir().join(format!(
                "codex-ydotool-{label}-{}-{}",
                process::id(),
                random_hex(8).expect("test nonce")
            ));
            let mut builder = fs::DirBuilder::new();
            builder.mode(0o700);
            builder.create(&path).expect("create test directory");
            fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
                .expect("secure test directory");
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fake_supported_ydotool(root: &Path) -> PathBuf {
        let path = root.join("ydotool");
        fs::write(
            &path,
            r#"#!/bin/sh
case "$1" in
  help|--help)
    printf '%s\n' \
      'Usage: ydotool <cmd> <args>' \
      'Available commands:' \
      '  click' \
      '  mousemove' \
      '  type' \
      '  key' \
      '  debug'
    ;;
  mousemove)
    test -S "$YDOTOOL_SOCKET" &&
      test "$2" = '--wheel' &&
      test "$3" = '--' &&
      test "$4" = '0' &&
      test "$5" = '0'
    ;;
  type)
    test -S "$YDOTOOL_SOCKET" &&
      test "$2" = '--file' &&
      test "$3" = '-'
    ;;
  *)
    exit 64
    ;;
esac
"#,
        )
        .expect("write fake ydotool");
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700))
            .expect("make fake ydotool executable");
        path
    }

    #[test]
    fn classifies_legacy_named_cli_from_ubuntu_ydotool() {
        let help = "Usage: ydotool <cmd> <args>\nAvailable commands:\n  type\n  recorder\n  mousemove\n  key\n  click\n";

        assert_eq!(classify_help(help), Some(CliGeneration::LegacyNamed));
    }

    #[test]
    fn classifies_raw_event_cli_from_current_ydotool() {
        let help = "Usage: ydotool <cmd> <args>\nAvailable commands:\n  click\n  mousemove\n  type\n  key\n  debug\n  stdin\n";

        assert_eq!(classify_help(help), Some(CliGeneration::RawEvents));
    }

    #[test]
    fn classifies_arch_1_0_4_cli_as_raw_events() {
        let help = "Usage: ydotool <cmd> <args>\nAvailable commands:\n  click\n  mousemove\n  type\n  key\n  debug\n  bakers\n";

        assert_eq!(classify_help(help), Some(CliGeneration::RawEvents));
    }

    #[test]
    fn accepts_supported_raw_cli_without_xdg_runtime_dir() {
        let root = TestDirectory::new("no-xdg-cli");
        let ydotool = fake_supported_ydotool(&root.0);

        assert_eq!(
            probe_with(&ydotool, None, &root.0),
            Ok("compatible raw-event CLI detected".to_string())
        );
        assert_eq!(
            fs::read_dir(&root.0)
                .expect("read test directory")
                .filter_map(Result::ok)
                .filter(|entry| {
                    entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".codex-ydotool-probe-")
                })
                .count(),
            0
        );
    }

    #[test]
    fn rejects_raw_cli_without_wheel_semantics() {
        assert!(!raw_semantic_probes_succeeded(
            true,
            b"mousemove: unrecognized option '--wheel'\n",
            true,
            b"",
        ));
    }

    #[test]
    fn rejects_raw_cli_without_stdin_file_semantics() {
        assert!(!raw_semantic_probes_succeeded(
            true,
            b"",
            false,
            b"ydotool: type: error: failed to open -: No such file or directory\n",
        ));
    }

    #[test]
    fn accepts_raw_cli_with_required_semantics() {
        assert!(raw_semantic_probes_succeeded(true, b"", true, b""));
    }

    #[test]
    fn rejects_unknown_cli_shape() {
        assert_eq!(classify_help("Usage: ydotool <cmd>"), None);
    }

    #[test]
    fn recognizes_cli_errors_even_when_exit_status_is_success() {
        assert_eq!(
            cli_error(b"error: unrecognised option '--absolute'\n"),
            Some("error: unrecognised option '--absolute'".to_string())
        );
    }

    #[test]
    fn ignores_non_error_stderr() {
        assert_eq!(cli_error(b"ydotoold socket ready\n"), None);
    }
}
