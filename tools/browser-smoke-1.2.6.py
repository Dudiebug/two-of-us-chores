import shutil
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
VIEWPORT = {"width": 412, "height": 915}
TOLERANCE = 3

server = subprocess.Popen(
    ["node", str(ROOT / "tools/browser-fixture.mjs")],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)


def box(page, selector):
    value = page.locator(selector).bounding_box()
    assert value, f"{selector} has no bounding box"
    return value


def assert_settings_height(page, selector, close_selector, expected_height=None):
    page.locator(selector).wait_for(state="visible")
    dialog = box(page, selector)
    close = box(page, close_selector)
    assert dialog["y"] >= 90, dialog
    assert dialog["height"] <= 0.86 * VIEWPORT["height"], dialog
    if expected_height is not None:
        assert abs(dialog["height"] - expected_height) <= TOLERANCE, (selector, dialog, expected_height)
    assert close["y"] >= dialog["y"], close
    assert close["y"] + close["height"] <= VIEWPORT["height"], close
    overflow = page.locator(f"{selector} .dialog-body").evaluate("el => getComputedStyle(el).overflowY")
    assert overflow == "auto", (selector, overflow)
    return dialog


try:
    assert server.stdout.readline().strip() == b"ready"
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            executable_path=shutil.which("chromium") or None,
            headless=True,
            args=["--no-sandbox"],
        )
        page = browser.new_page(viewport=VIEWPORT, device_scale_factor=1)
        page.goto("http://localhost:3099/login")
        page.locator("#loginUser").fill("dylan")
        page.locator("#loginPassword").fill("dylan-test-password")
        page.locator("#loginForm button[type=submit]").click()
        page.wait_for_url("**/app**")
        page.locator("#adminButton").wait_for(state="visible")

        # Settings is the mobile geometry baseline for every dialog.
        page.locator("#settingsButton").click()
        settings = assert_settings_height(page, "#settingsDialog", "#closeSettingsButton")
        baseline = settings["height"]
        page.locator("#closeSettingsButton").click()
        page.locator("#settingsDialog").wait_for(state="hidden")

        page.locator("#adminButton").click()
        assert_settings_height(page, "#adminDialog", "#closeAdmin", baseline)
        page.locator("#closeAdmin").click()
        page.locator("#adminDialog").wait_for(state="hidden")

        # Add chore uses the same dialog element as Edit chore and must match Settings.
        page.locator("#addChoreButton").click()
        assert_settings_height(page, "#choreDialog", "#closeChoreButton", baseline)
        page.locator("#choreTitle").fill("Dialog height regression")
        page.locator("#saveChoreButton").click()
        page.locator("#choreDialog").wait_for(state="hidden")

        row = page.locator(".chore-row", has_text="Dialog height regression")
        row.wait_for(state="visible")
        row.locator('[data-action="edit"]').click()
        assert page.locator("#choreDialogTitle").inner_text() == "Edit chore"
        assert_settings_height(page, "#choreDialog", "#closeChoreButton", baseline)

        # Exercise the expanded edit UI that previously made the sheet nearly full-screen.
        page.locator("#scheduleKind").select_option("weekly")
        page.locator("#reminderMode").select_option("override")
        assert page.locator("#weekdayPicker").is_visible()
        assert page.locator("#reminderTimeField").is_visible()
        expanded = assert_settings_height(page, "#choreDialog", "#closeChoreButton", baseline)
        assert abs(expanded["height"] - baseline) <= TOLERANCE
        body_metrics = page.locator("#choreDialog .dialog-body").evaluate(
            "el => ({clientHeight: el.clientHeight, scrollHeight: el.scrollHeight})"
        )
        assert body_metrics["scrollHeight"] >= body_metrics["clientHeight"], body_metrics

        # The delete confirmation is a separate dialog and must also use the
        # Settings mobile height per the global popup sizing contract.
        page.locator("#deleteChoreButton").click()
        assert_settings_height(page, "#confirmDialog", "#closeConfirmButton", baseline)
        page.locator("#cancelConfirmButton").click()
        page.locator("#confirmDialog").wait_for(state="hidden")

        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
