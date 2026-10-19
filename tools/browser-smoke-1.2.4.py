import subprocess, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
server = subprocess.Popen(['node', str(ROOT / 'tools/browser-fixture.mjs')], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
try:
    assert server.stdout.readline().strip() == b'ready'
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=shutil.which('chromium') or None, headless=True, args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 412, 'height': 915}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto('http://localhost:3099/login')
        page.locator('#loginUser').fill('alpha')
        page.locator('#loginPassword').fill('alpha-test-password')
        page.locator('#loginForm button[type=submit]').click()
        page.wait_for_url('**/app**')
        page.locator('#adminButton').wait_for(state='visible')

        assert page.locator('.group-toolbar').is_hidden()

        alpha = page.locator('.filter-button[data-filter="D"]')
        bravo = page.locator('.filter-button[data-filter="M"]')
        assert alpha.get_attribute('data-user-color') == 'teal'
        assert bravo.get_attribute('data-user-color') == 'rose'
        alpha_bg = alpha.evaluate('(el) => getComputedStyle(el).backgroundColor')
        bravo_bg = bravo.evaluate('(el) => getComputedStyle(el).backgroundColor')
        assert alpha_bg != bravo_bg

        page.locator('#addChoreButton').click()
        page.locator('#choreAssignee').select_option('M')
        assert page.locator('#choreAssignee').get_attribute('data-user-color') == 'rose'
        page.locator('#choreTitle').fill('Color smoke test')
        page.locator('#saveChoreButton').click()
        page.locator('#choreDialog').wait_for(state='hidden')
        row = page.locator('.chore-row', has_text='Color smoke test')
        row.wait_for(state='visible')
        assert row.get_attribute('data-user-color') == 'rose'
        assert row.evaluate('(el) => getComputedStyle(el).backgroundColor') == bravo_bg

        for trigger, dialog, close in [
            ('#settingsButton', '#settingsDialog', '#closeSettingsButton'),
            ('#adminButton', '#adminDialog', '#closeAdmin'),
        ]:
            page.locator(trigger).click()
            page.locator(dialog).wait_for(state='visible')
            box = page.locator(dialog).bounding_box()
            close_box = page.locator(close).bounding_box()
            assert box and box['y'] >= 90, box
            assert box['height'] <= 0.86 * 915, box
            assert close_box and close_box['y'] >= box['y'] and close_box['y'] + close_box['height'] <= 915, close_box
            page.locator(close).click()
            page.locator(dialog).wait_for(state='hidden')

        normal_user = browser.new_page(viewport={'width': 412, 'height': 915}, device_scale_factor=1)
        normal_user.on('pageerror', lambda error: errors.append(str(error)))
        normal_user.goto('http://localhost:3099/login')
        normal_user.locator('#loginUser').fill('bravo')
        normal_user.locator('#loginPassword').fill('bravo-test-password')
        normal_user.locator('#loginForm button[type=submit]').click()
        normal_user.wait_for_url('**/app**')
        bravo = normal_user.locator('.filter-button[data-filter="M"]')
        bravo.wait_for(state='visible')
        assert normal_user.locator('#adminButton').is_hidden()
        assert bravo.get_attribute('data-user-color') == 'rose'
        bravo_bg = bravo.evaluate('(el) => getComputedStyle(el).backgroundColor')

        normal_user.locator('#settingsButton').click()
        normal_user.locator('#settingsDialog').wait_for(state='visible')
        normal_user.locator('#userColorOptions input[value="green"]').check()
        with normal_user.expect_response(lambda response: response.url.endswith('/api/settings') and response.request.method == 'PATCH') as response_info:
            normal_user.locator('#userColorForm button[type=submit]').click()
        response = response_info.value
        assert response.status == 204
        assert response.request.post_data_json == {'colorKey': 'green'}
        normal_user.locator('#userColorSuccess').wait_for(state='visible')
        assert bravo.get_attribute('data-user-color') == 'green'
        assert bravo.evaluate('(el) => getComputedStyle(el).backgroundColor') != bravo_bg

        api_state = normal_user.evaluate("async () => (await fetch('/api/state')).json()")
        assert api_state['user']['id'] == 'M'
        assert api_state['user']['colorKey'] == 'green'
        assert next(user for user in api_state['users'] if user['id'] == 'M')['colorKey'] == 'green'

        normal_user.reload()
        bravo = normal_user.locator('.filter-button[data-filter="M"]')
        bravo.wait_for(state='visible')
        assert bravo.get_attribute('data-user-color') == 'green'
        normal_user.locator('#settingsButton').click()
        normal_user.locator('#settingsDialog').wait_for(state='visible')
        assert normal_user.locator('#userColorOptions input[value="green"]').is_checked()

        assert not errors, errors
        browser.close()
finally:
    server.terminate()
    server.wait(timeout=5)
