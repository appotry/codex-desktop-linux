//! Shared test helpers.
//!
//! Several tests across modules mutate process-wide env vars
//! (`HOME`, `PATH`, `NVM_DIR`, `CODEX_CLI_PATH`, display sockets, ...) so
//! they can drive `command_path_env`, `npm_program`, and
//! `hydrate_session_bus_env` deterministically. Cargo runs unit tests in
//! parallel; without serialisation those mutations race across threads
//! — on a developer machine with `nvm` installed the tests would otherwise
//! pick up the real `~/.nvm/.../bin/npm` instead of the temp-dir fake. Each
//! test that touches env vars must hold this lock for its entire body.

use std::sync::{Mutex, MutexGuard, OnceLock};

pub(crate) fn env_lock() -> MutexGuard<'static, ()> {
    static ENV_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
    ENV_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|err| err.into_inner())
}

pub(crate) struct EnvRestoreGuard {
    saved: Vec<(&'static str, Option<std::ffi::OsString>)>,
}

impl EnvRestoreGuard {
    pub(crate) fn capture(keys: &[&'static str]) -> Self {
        Self {
            saved: keys
                .iter()
                .map(|key| (*key, std::env::var_os(key)))
                .collect(),
        }
    }
}

impl Drop for EnvRestoreGuard {
    fn drop(&mut self) {
        for (key, value) in &self.saved {
            if let Some(value) = value {
                std::env::set_var(key, value);
            } else {
                std::env::remove_var(key);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{env_lock, EnvRestoreGuard};

    #[test]
    fn env_restore_guard_restores_variables_after_panic() {
        let _env_guard = env_lock();
        let original_display = std::env::var_os("DISPLAY");
        let original_wayland_display = std::env::var_os("WAYLAND_DISPLAY");

        let _ = std::panic::catch_unwind(|| {
            let _restore_env = EnvRestoreGuard::capture(&["DISPLAY", "WAYLAND_DISPLAY"]);
            std::env::set_var("DISPLAY", ":panic-test");
            std::env::remove_var("WAYLAND_DISPLAY");
            panic!("intentional panic to verify env restoration");
        });

        assert_eq!(std::env::var_os("DISPLAY"), original_display);
        assert_eq!(
            std::env::var_os("WAYLAND_DISPLAY"),
            original_wayland_display
        );
    }
}
