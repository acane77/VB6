#!/usr/bin/env python3
"""Shared-file removal and reference relocation through the shipped group UI.

Reuse the native-project harness, but run only this module's cases. CI exercises
HTTP and file origins; VB6_TEST_TRANSPORT=memory is a separately labelled smoke.
"""
import importlib.util
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('native_project_harness', Path(__file__).with_name('native-project-browser-tests.py'))
harness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


class WorkspaceReview(harness.NativeProjects):
    def shared_group(self):
        files = self.simple_group()
        files['B.vbp'] = files['B.vbp'].replace(b'Module=N; B.bas', b'Module=M; A.bas')
        del files['B.bas']
        return files

    def edit_shared_source(self):
        self.js("() => {vb6Studio.openDocument(vb6Studio.project.modules[0].id,'code');vb6Studio.editor.input.dataset.sharedEditor='true';}")
        editor = self.page.locator('[data-shared-editor=true]')
        editor.fill(editor.input_value() + "\n' Preserve shared edit\n")
        self.page.wait_for_function("vb6Studio.project.modules[0].code.includes('Preserve shared edit')")

    def case_removal_blocks_shared_edit_loss(self):
        self.load(self.shared_group(), 'Suite.vbg')
        self.edit_shared_source()
        before = self.js('JSON.stringify(vb6Studio.project)')
        history = self.js('vb6Studio.history.undoStack.length')
        self.start('vb6Studio.command("nativeGroup")')
        self.page.get_by_role('button', name='Remove from Group', exact=True).click()
        self.page.get_by_text('edits to shared file A.bas would be lost', exact=False).wait_for()
        self.button('OK')
        self.assertEqual(self.page.get_by_label('Projects in group', exact=True).locator('option').count(), 2)
        self.button('Cancel'); self.result(False)
        self.assertEqual(self.js('JSON.stringify(vb6Studio.project)'), before)
        self.assertEqual(self.js('vb6Studio.history.undoStack.length'), history)
        self.assertIn(b'Preserve shared edit', self.export()['A.bas'])
        self.assertTrue(self.js('vb6Studio.dirty'))

    def case_synchronized_removal_and_undo_preserve_shared_edits(self):
        self.load(self.shared_group(), 'Suite.vbg'); self.edit_shared_source()
        files = self.native_download(); self.load(files, 'Suite.vbg')
        self.start('vb6Studio.command("nativeGroup")')
        self.page.get_by_role('button', name='Remove from Group', exact=True).click()
        self.button('OK'); self.result(True)
        self.assertEqual(self.js('vb6Studio.project.name'), 'B')
        self.assertEqual(self.export()['A.bas'], files['A.bas'])
        self.js('() => vb6Studio.command("undo")')
        self.assertEqual(self.js('vb6Studio.project.nativeWorkspace.order'), ['A.vbp', 'B.vbp'])
        self.js('() => vb6Studio.command("redo")')
        self.assertEqual(self.js('vb6Studio.project.nativeWorkspace.order'), ['B.vbp'])
        self.assertEqual(self.export()['A.bas'], files['A.bas'])

    def case_removal_does_not_hide_divergent_shared_edits(self):
        self.load(self.shared_group(), 'Suite.vbg'); self.edit_shared_source()
        self.edit('vb6Studio.project.nativeWorkspace.peers[0].modules[0].code+="\\n\' Other edit"')
        before = self.js('JSON.stringify(vb6Studio.project)')
        self.start('vb6Studio.command("nativeGroup")')
        self.page.get_by_role('button', name='Remove from Group', exact=True).click()
        self.page.get_by_text('Conflicting edits to shared file A.bas', exact=False).wait_for()
        self.button('OK'); self.button('Cancel'); self.result(False)
        self.assertEqual(self.js('JSON.stringify(vb6Studio.project)'), before)

    def case_quoted_project_relocation_survives_download(self):
        files = self.simple_group(); files['A.vbp'] += b'Reference=*\\AB.vbp\r\n'
        self.load(files, 'Suite.vbg'); self.start('vb6Studio.command("nativeGroup")')
        self.page.get_by_label('Projects in group', exact=True).select_option('B.vbp')
        destination = "library/John 's Library.vbp"
        self.page.get_by_label('Project manifest path', exact=True).fill(destination)
        self.page.get_by_role('button', name='Apply Path', exact=True).click()
        self.button('OK'); self.result(True)
        files = self.native_download(); self.assertIn(destination, files)
        self.assertNotIn('B.vbp', files)
        self.load(files, 'Suite.vbg'); self.start('vb6Studio.command("nativeGroup")')
        self.assertEqual(self.page.get_by_label('Project dependency order', exact=True).inner_text(), 'Dependency order: ' + destination + ' → A.vbp')
        self.button('Cancel'); self.result(False)


cases = [name for name in vars(WorkspaceReview) if name.startswith('case_')]
transports = ['memory'] if os.environ.get('VB6_TEST_TRANSPORT') == 'memory' else ['http', 'file']
selected_tests = []
for case in cases:
    for transport in transports:
        name = 'test_' + case[5:] + '_' + transport
        setattr(WorkspaceReview, name, getattr(WorkspaceReview, case))
        selected_tests.append(name)


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(WorkspaceReview(name) for name in selected_tests)


if __name__ == '__main__':
    unittest.main(verbosity=2)
