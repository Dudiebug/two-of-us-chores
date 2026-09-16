import shutil
import subprocess
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://localhost:3099"
VIEWPORTS = [
    ("Pixel-sized Android", {"width": 412, "height": 915}),
    ("small Android", {"width": 320, "height": 568}),
]
SAFE_TOP_GAP = 96
TOLERANCE = 3


def box(page, selector):
    value = page.locator(selector).bounding_box()
    assert value, f"{selector} has no bounding box"
    return value


def assert_inside_viewport(value, viewport, label):
    assert value["x"] >= -TOLERANCE, (label, value)
    assert value["y"] >= -TOLERANCE, (label, value)
    assert value["x"] + value["width"] <= viewport["width"] + TOLERANCE, (label, value)
    assert value["y"] + value["height"] <= viewport["height"] + TOLERANCE, (label, value)


def assert_dialog_geometry(page, selector, close_selector, viewport, expected_height=None):
    page.locator(selector).wait_for(state="visible")
    dialog = box(page, selector)
    rendered_height = page.evaluate("window.innerHeight")
    rendered_width = page.evaluate("window.innerWidth")
    assert rendered_height == viewport["height"], (viewport, rendered_height)
    assert rendered_width == viewport["width"], (viewport, rendered_width)

    expected_css_height = min(0.84 * rendered_height, rendered_height - SAFE_TOP_GAP)
    assert abs(dialog["height"] - expected_css_height) <= TOLERANCE, (selector, dialog, expected_css_height)
    assert dialog["y"] >= SAFE_TOP_GAP - TOLERANCE, (selector, dialog)
    assert abs(dialog["y"] + dialog["height"] - rendered_height) <= TOLERANCE, (selector, dialog)
    assert_inside_viewport(dialog, viewport, selector)

    if expected_height is not None:
        assert abs(dialog["height"] - expected_height) <= TOLERANCE, (selector, dialog, expected_height)

    header = box(page, f"{selector} .dialog-header")
    close = box(page, close_selector)
    assert header["y"] >= dialog["y"] - TOLERANCE, (selector, header, dialog)
    assert header["y"] + header["height"] <= rendered_height + TOLERANCE, (selector, header)
    assert_inside_viewport(close, viewport, close_selector)
    assert close["y"] >= header["y"] - TOLERANCE, (close_selector, header, close)
    assert close["y"] + close["height"] <= header["y"] + header["height"] + TOLERANCE, (close_selector, header, close)

    body = page.locator(f"{selector} .dialog-body")
    overflow = body.evaluate("el => getComputedStyle(el).overflowY")
    assert overflow == "auto", (selector, overflow)

    actions = page.locator(f"{selector} .dialog-actions")
    if actions.count():
        action_box = box(page, f"{selector} .dialog-actions")
        assert_inside_viewport(action_box, viewport, f"{selector} .dialog-actions")
        assert action_box["y"] >= dialog["y"] - TOLERANCE, (selector, action_box, dialog)

    return dialog


def assert_scroll_contract(page, selector, viewport, require_scroll):
    body = page.locator(f"{selector} .dialog-body")
    metrics = body.evaluate(
        """el => {
            el.scrollTop = el.scrollHeight;
            return {
                clientHeight: el.clientHeight,
                scrollHeight: el.scrollHeight,
                scrollTop: el.scrollTop,
                overflowY: getComputedStyle(el).overflowY
            };
        }"""
    )
    assert metrics["overflowY"] == "auto", (selector, metrics)
    if require_scroll:
        assert metrics["scrollHeight"] > metrics["clientHeight"] + 1, (selector, metrics)
        assert metrics["scrollTop"] + metrics["clientHeight"] >= metrics["scrollHeight"] - 1, (selector, metrics)

    dialog = box(page, selector)
    header = box(page, f"{selector} .dialog-header")
    title = box(page, f"{selector} h2")
    assert header["y"] >= dialog["y"] - TOLERANCE, (selector, header, dialog)
    assert header["y"] + header["height"] <= viewport["height"] + TOLERANCE, (selector, header)
    assert_inside_viewport(title, viewport, f"{selector} h2")

    actions = page.locator(f"{selector} .dialog-actions")
    if actions.count():
        action_box = box(page, f"{selector} .dialog-actions")
        assert_inside_viewport(action_box, viewport, f"{selector} .dialog-actions")


def login(page):
    page.goto(f"{BASE_URL}/login")
    page.locator("#loginUser").fill("dylan")
    page.locator("#loginPassword").fill("dylan-test-password")
    page.locator("#loginForm button[type=submit]").click()
    page.wait_for_url("**/app**")
    page.locator("#adminButton").wait_for(state="visible")


server = subprocess.Popen(
    ["node", str(ROOT / "tools/browser-fixture.mjs")],
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

try:
    assert server.stdout.readline().strip() == b"ready"
    with sync_playwright() as pw:
        launch_options = {"headless": True, "args": ["--no-sandbox"]}
        executable = shutil.which("chromium")
        if executable:
            launch_options["executable_path"] = executable
        browser = pw.chromium.launch(**launch_options)

        for viewport_name, viewport in VIEWPORTS:
            context = browser.new_context(
                viewport=viewport,
                device_scale_factor=1,
                has_touch=True,
                is_mobile=True,
            )
            page = context.new_page()
            login(page)

            # Settings is the rendered mobile geometry baseline for every dialog.
            page.locator("#settingsButton").click()
            settings = assert_dialog_geometry(
                page, "#settingsDialog", "#closeSettingsButton", viewport
            )
            baseline = settings["height"]
            assert_scroll_contract(page, "#settingsDialog", viewport, require_scroll=True)
            page.locator("#closeSettingsButton").click()
            page.locator("#settingsDialog").wait_for(state="hidden")

            # Admin is opened by the admin account used by the fixture.
            page.locator("#adminButton").click()
            assert_dialog_geometry(page, "#adminDialog", "#closeAdmin", viewport, baseline)
            assert_scroll_contract(page, "#adminDialog", viewport, require_scroll=True)
            page.locator("#closeAdmin").click()
            page.locator("#adminDialog").wait_for(state="hidden")

            # Add chore and Edit chore intentionally share #choreDialog.
            title = f"Dialog height regression {viewport_name}"
            page.locator("#addChoreButton").click()
            assert_dialog_geometry(page, "#choreDialog", "#closeChoreButton", viewport, baseline)
            assert_scroll_contract(page, "#choreDialog", viewport, require_scroll=False)
            page.locator("#choreTitle").fill(title)
            page.locator("#saveChoreButton").click()
            page.locator("#choreDialog").wait_for(state="hidden")

            row = page.locator(".chore-row", has_text=title)
            row.wait_for(state="visible")
            row.locator('[data-action="edit"]').click()
            assert page.locator("#choreDialogTitle").inner_text() == "Edit chore"
            assert_dialog_geometry(page, "#choreDialog", "#closeChoreButton", viewport, baseline)

            # A real click verifies that the Edit close button is reachable and usable.
            page.locator("#closeChoreButton").click()
            page.locator("#choreDialog").wait_for(state="hidden")

            row.locator('[data-action="edit"]').click()
            page.locator("#scheduleKind").select_option("weekly")
            page.locator("#reminderMode").select_option("override")
            assert page.locator("#weekdayPicker").is_visible()
            assert page.locator("#reminderTimeField").is_visible()
            assert_dialog_geometry(page, "#choreDialog", "#closeChoreButton", viewport, baseline)
            assert_scroll_contract(page, "#choreDialog", viewport, require_scroll=True)

            # Delete/confirmation is separate from the shared chore dialog.
            page.locator("#deleteChoreButton").click()
            assert_dialog_geometry(page, "#confirmDialog", "#closeConfirmButton", viewport, baseline)
            assert_scroll_contract(page, "#confirmDialog", viewport, require_scroll=False)
            page.locator("#cancelConfirmButton").click()
            page.locator("#confirmDialog").wait_for(state="hidden")

            print(f"{viewport_name}: all four dialogs matched {baseline:.2f}px Settings height")
            context.close()

        browser.close()
finally:
    server.terminate()
    try:
        server.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server.kill()
        server.wait(timeout=5)
