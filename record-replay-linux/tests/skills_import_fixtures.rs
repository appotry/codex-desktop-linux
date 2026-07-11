use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

use codex_record_replay_linux::{
    import_skill, inspect_skill, ImportMode, ImportTarget, SkillCapability, SkillImportOptions,
    SkillStatus,
};

fn write_skill(root: &Path, name: &str, description: &str, body: &str) {
    fs::create_dir_all(root).unwrap();
    fs::write(
        root.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {description}\n---\n\n{body}\n"),
    )
    .unwrap();
}

fn fixture_skill(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/skills")
        .join(name)
}

fn import_options(source: &Path, target_dir: &Path) -> SkillImportOptions {
    SkillImportOptions {
        source: source.to_path_buf(),
        target: ImportTarget::Explicit,
        target_dir: Some(target_dir.to_path_buf()),
        mode: ImportMode::Copy,
        dry_run: true,
        allow_unsupported: false,
        overwrite: false,
    }
}

#[test]
fn instruction_only_defaults_to_supported_importable_skill() {
    let temp = tempfile::tempdir().unwrap();
    let fixture = fixture_skill("instruction-only");
    let skill = temp.path().join("instruction-only");
    // DrvFS can expose every tracked fixture file as executable, so materialize
    // the mode this test is meant to classify.
    fs::create_dir(&skill).unwrap();
    fs::copy(fixture.join("SKILL.md"), skill.join("SKILL.md")).unwrap();
    fs::set_permissions(skill.join("SKILL.md"), fs::Permissions::from_mode(0o644)).unwrap();

    let inspection = inspect_skill(&skill).unwrap();
    assert_eq!(inspection.status, SkillStatus::Supported);
    assert!(inspection
        .capabilities
        .contains(&SkillCapability::InstructionOnly));

    let report = import_skill(import_options(&skill, &temp.path().join("target"))).unwrap();
    assert!(report.ok);
    assert!(!report.imported);
    assert!(report.destination.ends_with("instruction-only"));
}

#[test]
fn platform_macos_is_unsupported_without_executing_anything() {
    let skill = fixture_skill("platform-macos");

    let inspection = inspect_skill(&skill).unwrap();
    assert_eq!(inspection.status, SkillStatus::Unsupported);
    assert!(inspection
        .capabilities
        .contains(&SkillCapability::PlatformMacos));
    let temp = tempfile::tempdir().unwrap();
    assert!(import_skill(import_options(&skill, &temp.path().join("target"))).is_err());
}

#[test]
fn desktop_action_is_classified_as_experimental() {
    let skill = fixture_skill("desktop-act");

    let inspection = inspect_skill(&skill).unwrap();
    assert_eq!(inspection.status, SkillStatus::Experimental);
    assert!(inspection
        .capabilities
        .contains(&SkillCapability::DesktopAct));
    assert!(inspection
        .capabilities
        .contains(&SkillCapability::DesktopObserve));
}

#[cfg(unix)]
#[test]
fn unsafe_symlink_is_rejected_without_execution() {
    use std::os::unix::fs as unix_fs;

    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("unsafe-symlink");
    write_skill(
        &skill,
        "Unsafe Symlink",
        "Use when testing symlink safety.",
        "This skill should not import internal symlinks.",
    );
    unix_fs::symlink("/etc/passwd", skill.join("leak")).unwrap();

    let inspection = inspect_skill(&skill).unwrap();
    assert!(!inspection.ok);
    assert!(inspection
        .blockers
        .iter()
        .any(|blocker| blocker.contains("internal symlink")));
}

#[test]
fn collision_and_tripwire_behavior_is_non_executing() {
    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("collision-tripwire");
    write_skill(
        &skill,
        "Collision Tripwire",
        "Use when testing script handling.",
        "Click and type in the desktop app.",
    );
    fs::create_dir(skill.join("scripts")).unwrap();
    let marker = temp.path().join("tripwire-ran");
    fs::write(
        skill.join("scripts").join("tripwire.sh"),
        format!(
            "#!/usr/bin/env bash\n# TRIPWIRE SHOULD NEVER RUN\ntouch {}\n",
            marker.display()
        ),
    )
    .unwrap();
    let target = temp.path().join("target");
    fs::create_dir_all(target.join("collision-tripwire")).unwrap();

    let inspection = inspect_skill(&skill).unwrap();
    assert!(inspection.capabilities.contains(&SkillCapability::CliLocal));
    assert!(inspection
        .warnings
        .iter()
        .any(|warning| warning.contains("executable/script")));
    assert!(
        !marker.exists(),
        "inspector must not execute skill-owned scripts"
    );

    let result = import_skill(SkillImportOptions {
        dry_run: false,
        ..import_options(&skill, &target)
    });
    assert!(result.is_err(), "target collision should fail by default");
    assert!(
        !marker.exists(),
        "importer must not execute skill-owned scripts"
    );
}

#[test]
fn dotdot_skill_name_cannot_escape_import_root() {
    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("dotdot");
    write_skill(
        &skill,
        "..",
        "Use when testing import path safety.",
        "Instruction-only skill.",
    );
    let target = temp.path().join("target");

    let result = import_skill(SkillImportOptions {
        dry_run: true,
        ..import_options(&skill, &target)
    });

    assert!(result.is_err());
    assert!(!temp.path().join("SKILL.md").exists());
}

#[test]
fn missing_frontmatter_is_a_blocker_for_import() {
    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("missing-frontmatter");
    fs::create_dir(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "No frontmatter here.\n").unwrap();

    let inspection = inspect_skill(&skill).unwrap();
    assert!(!inspection.ok);
    assert!(inspection
        .blockers
        .iter()
        .any(|blocker| blocker.contains("frontmatter")));

    let target = temp.path().join("target");
    assert!(import_skill(import_options(&skill, &target)).is_err());
}

#[test]
fn oversized_or_unscanned_skill_files_block_import() {
    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("oversized");
    write_skill(
        &skill,
        "Oversized",
        "Use when testing oversized skill files.",
        "Instruction-only skill.",
    );
    fs::write(skill.join("large.txt"), vec![b'x'; 256 * 1024 + 1]).unwrap();

    let inspection = inspect_skill(&skill).unwrap();
    assert!(!inspection.ok);
    assert!(inspection
        .blockers
        .iter()
        .any(|blocker| blocker.contains("large file")));

    let target = temp.path().join("target");
    assert!(import_skill(import_options(&skill, &target)).is_err());
}

#[cfg(unix)]
#[test]
fn copied_skill_modes_are_normalized() {
    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("permissive-source");
    write_skill(
        &skill,
        "Permissive Source",
        "Use when testing import permissions.",
        "Instruction-only skill.",
    );
    fs::set_permissions(skill.join("SKILL.md"), fs::Permissions::from_mode(0o777)).unwrap();
    let target = temp.path().join("target");

    let report = import_skill(SkillImportOptions {
        dry_run: false,
        ..import_options(&skill, &target)
    })
    .unwrap();

    let mode = fs::metadata(report.destination.join("SKILL.md"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o644);
}

#[cfg(unix)]
#[test]
fn copied_skill_script_modes_follow_source_execute_bits() {
    let temp = tempfile::tempdir().unwrap();
    let skill = temp.path().join("script-modes");
    write_skill(
        &skill,
        "Script Modes",
        "Use when testing imported script permissions.",
        "Instruction-only skill.",
    );
    fs::create_dir(skill.join("scripts")).unwrap();
    fs::write(
        skill.join("scripts").join("passive.py"),
        "print('passive')\n",
    )
    .unwrap();
    fs::write(
        skill.join("scripts").join("runner.sh"),
        "#!/usr/bin/env bash\ntrue\n",
    )
    .unwrap();
    fs::set_permissions(
        skill.join("scripts").join("passive.py"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    fs::set_permissions(
        skill.join("scripts").join("runner.sh"),
        fs::Permissions::from_mode(0o755),
    )
    .unwrap();
    let target = temp.path().join("target");

    let report = import_skill(SkillImportOptions {
        dry_run: false,
        ..import_options(&skill, &target)
    })
    .unwrap();

    let passive_mode = fs::metadata(report.destination.join("scripts/passive.py"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    let runner_mode = fs::metadata(report.destination.join("scripts/runner.sh"))
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(passive_mode, 0o644);
    assert_eq!(runner_mode, 0o755);
}
