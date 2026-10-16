"""Real IDE input cases shared by the agent browser runner; no live provider keys."""
import json
from pathlib import Path


def workflow_cases(env):
    check, tab, mock, configure, start, finish = (env[name] for name in ('check', 'tab', 'mock', 'configure', 'start', 'finish'))
    packet, reports = env['packet'], env['REPORTS']

    def continuation(page):
        page.locator('.agent-panel').get_by_role('button', name='Continue', exact=True).click()
        dialog = page.get_by_role('dialog', name='AI Coding Agent — Continue Task', exact=True)
        check('1 completed operation(s)' in dialog.inner_text())
        dialog.get_by_role('button', name='Continue Task', exact=True).click()
        finish(page)

    def paused_prefix(page, mode, provider):
        requests = mock(page, provider, lambda index, body: ([{'name': 'vb6_module_read', 'arguments': {'module': 'Form1'}}, {'name': 'vb6_module_read', 'arguments': {'module': 'Form1'}}], 'Read twice.') if index == 1 else ([], 'Confirmed both reads.'))
        configure(page, provider, mode='readonly')
        page.evaluate("""() => {
          const tool=vb6Studio.codingAgents.adapter.tools.find(t=>t.name==='vb6.module.read'), execute=tool.execute;
          window.confirmedReads=0; window.readStarted=false;
          tool.execute=async (args,context)=>{
            if(!window.readStarted){window.readStarted=true;await new Promise((resolve,reject)=>{
              const abort=()=>reject(context.signal.reason);context.signal.addEventListener('abort',abort,{once:true});
              window.releaseRead=()=>{context.signal.removeEventListener('abort',abort);resolve();};
            });}
            const result=await execute(args,context);window.confirmedReads++;return result;
          };
        }""")
        start(page)
        page.wait_for_function('window.readStarted')
        pause = page.locator('.agent-panel').get_by_role('button', name='Pause', exact=True)
        pause.click()
        check(pause.is_disabled())
        check(page.evaluate('vb6Studio.codingAgents.agent.busy && !vb6Studio.codingAgents.agent.controller.signal.aborted'))
        page.evaluate('releaseRead()')
        finish(page)
        check(len(requests) == 1)
        check(page.evaluate('confirmedReads===1 && vb6Studio.codingAgents.agent.pendingTurn.outputs.length===1'))
        check(page.evaluate("vb6Studio.codingAgents.agent.limit.kind==='user' && !vb6Studio.codingAgents.agent.permissionSession.snapshot().active"))
        page.get_by_label('Agent task', exact=True).fill('Do not send this unsent draft.')
        continuation(page)
        check(page.evaluate("confirmedReads===2 && vb6Studio.codingAgents.agent.state==='completed' && vb6Studio.codingAgents.agent.usage.calls===2"))
        check(len(requests) == 2 and 'Do not send this unsent draft.' not in json.dumps(requests))
        if provider == 'openai': outputs = [item for item in requests[1]['input'] if item.get('type') == 'function_call_output']
        elif provider == 'anthropic': outputs = [item for message in requests[1]['messages'] if isinstance(message.get('content'), list) for item in message['content'] if item.get('type') == 'tool_result']
        else: outputs = [part for message in requests[1]['contents'] for part in message['parts'] if 'functionResponse' in part]
        check(len(outputs) == 2)
        check(page.get_by_label('Agent task', exact=True).input_value() == 'Do not send this unsent draft.')
        page.screenshot(path=str(reports / f'{mode}-{provider}-cooperative-pause.png'))
        return {'provider': provider, 'confirmedReads': 2, 'requests': 2, 'freshConsent': True, 'prefixNeverReplayed': True}

    def pause_then_stop(page, mode):
        held = []
        page.route('https://api.openai.com/**', lambda route: held.append(route))
        configure(page, mode='readonly'); start(page)
        page.wait_for_function('vb6Studio.codingAgents.agent.usage.requests===1')
        page.locator('.agent-panel').get_by_role('button', name='Pause', exact=True).click()
        check(page.evaluate('vb6Studio.codingAgents.agent.busy'))
        page.locator('.agent-panel').get_by_role('button', name='Stop', exact=True).click(); finish(page)
        check(page.evaluate('vb6Studio.codingAgents.agent.blocked && !vb6Studio.codingAgents.agent.canResume && !vb6Studio.codingAgents.agent.pendingTurn'))
        check(page.evaluate('vb6Studio.codingAgents.agent.usage.calls===0'))
        for route in held:
            try: route.abort()
            except Exception: pass
        return {'pauseDoesNotAbortRequest': True, 'stopOverridesPause': True, 'zeroTools': True}

    def seed_search(page):
        return page.evaluate("""() => {
          const api=vb6Studio.codingAgents,agent=api.agent;
          for(let i=0;i<360;i++) agent.emit('user',(i===3||i===190?'Needle [a+b]* ':'History ')+i);
          agent.emit('tool','vb6.module.read',{requestId:'search',callId:'one',arguments:{module:'Form1'}});
          agent.emit('result','Read',{requestId:'search',callId:'one',result:{text:'collapsed-only marker <img src=x onerror="window.injected=true">'}});
          agent.history.push({native:'PRIVATE_NATIVE_SEARCH_NEEDLE'});
          return {task:api.conversations.activeId, ids:agent.thread.entries.filter(e=>e.text.includes('Needle [a+b]*')).map(e=>e.id)};
        }""")

    def search_navigation(page, mode):
        data = seed_search(page)
        page.wait_for_function("document.querySelectorAll('.agent-thread-entry').length===150")
        query = page.get_by_label('Search conversation', exact=True)
        query.fill('[a+b]*')
        page.wait_for_function("document.querySelector('.agent-find-count')?.textContent==='1 of 2 matching entries'")
        check(page.locator('.is-search-match').get_attribute('data-entry-id') == data['ids'][0])
        check(page.locator('.agent-thread-entry').count() <= 150)
        query.press('Enter')
        check(page.locator('.is-search-match').get_attribute('data-entry-id') == data['ids'][1])
        query.press('Shift+Enter')
        check(page.locator('.is-search-match').get_attribute('data-entry-id') == data['ids'][0])
        page.get_by_label('Conversation search scope', exact=True).select_option('tools')
        query.fill('collapsed-only')
        page.wait_for_function("document.querySelector('.is-search-match')?.open===true")
        check('collapsed-only' in page.locator('.is-search-match').inner_text())
        check(page.locator('.agent-conversation img').count() == 0 and not page.evaluate('!!window.injected'))
        query.fill('PRIVATE_NATIVE_SEARCH_NEEDLE')
        check(page.get_by_label('Conversation search results', exact=True).inner_text() == '0 of 0 matching entries')
        query.press('Escape')
        check(query.input_value() == '')
        page.get_by_label('Agent conversation', exact=True).press('Control+f')
        check(query.evaluate('e=>e===document.activeElement'))
        check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests') == 0)
        page.screenshot(path=str(reports / f'{mode}-conversation-search.png'))
        return {'literalSearch': True, 'wholeBoundedHistory': True, 'collapsedTools': True, 'keyboardNavigation': True, 'nativeHistoryExcluded': True}

    def search_retention(page, mode):
        data = seed_search(page)
        query = page.get_by_label('Search conversation', exact=True); query.fill('[a+b]*'); query.press('Enter')
        page.wait_for_function("document.querySelector('.agent-find-count')?.textContent==='2 of 2 matching entries'")
        page.evaluate("window.searchTop=vb6Studio.documents.tools.get('tool:coding-agents').log.scrollTop")
        page.evaluate("""() => {
          const agent=vb6Studio.codingAgents.agent;agent.emit('status','Streaming',{requestId:'new'});
          for(let i=0;i<25;i++)agent.emit('delta','New response ',{requestId:'new'});
        }""")
        page.wait_for_function("vb6Studio.documents.tools.get('tool:coding-agents').threadView.search.version===vb6Studio.codingAgents.agent.thread.revision")
        check(page.locator('.is-search-match').get_attribute('data-entry-id') == data['ids'][1])
        check(page.evaluate("Math.abs(vb6Studio.documents.tools.get('tool:coding-agents').log.scrollTop-searchTop)<2"))
        page.get_by_role('button', name='New Task', exact=True).click()
        check(query.input_value() == '')
        tab(page, 'Tasks'); page.get_by_label('Agent tasks', exact=True).select_option(data['task']); tab(page, 'Task')
        check(query.input_value() == '[a+b]*')
        check(page.locator('.is-search-match').get_attribute('data-entry-id') == data['ids'][1])
        page.evaluate("vb6Studio.documents.closeTool('tool:coding-agents');vb6Studio.command('codingAgents');")
        check(query.input_value() == '[a+b]*')
        check(page.locator('.is-search-match').get_attribute('data-entry-id') == data['ids'][1])
        page.evaluate("for(let i=0;i<1300;i++)vb6Studio.codingAgents.agent.emit('user','Replacement '+i)")
        page.wait_for_function("document.querySelector('.agent-find-count')?.textContent==='0 of 0 matching entries'")
        check(page.locator('.is-search-match').count() == 0)
        check(page.evaluate("vb6Studio.documents.tools.get('tool:coding-agents').threadView.search.cache.size<=1200"))
        return {'streamPreservesMatchAndPosition': True, 'taskAndReopenRetention': True, 'prunedMatchesRemoved': True}

    def upload(page, value):
        tab(page, 'Tasks')
        with page.expect_file_chooser() as chooser:
            page.get_by_role('button', name='Import public context…', exact=True).click()
        buffer = value if isinstance(value, bytes) else json.dumps(value).encode()
        chooser.value.set_files({'name': 'context.json', 'mimeType': 'application/json', 'buffer': buffer})

    def archive_seed(page):
        return page.evaluate("""() => {
          const api=vb6Studio.codingAgents,task=api.conversations.active,a=task.agent;
          a.emit('user','Earlier public question');a.emit('assistant','Selected public answer',{requestId:'past'});
          window.forkMessage=a.thread.entries.at(-1).id;
          a.emit('user','FUTURE_MESSAGE_MUST_NOT_BE_FORKED');a.emit('assistant','Later answer',{requestId:'later'});
          a.emit('tool','vb6.module.read',{requestId:'later',callId:'private',arguments:{private:'TOOL_ARGUMENT_SENTINEL'}});
          a.emit('result','Tool complete',{requestId:'later',callId:'private',result:{private:'TOOL_RESULT_SENTINEL'}});
          a.history.push({encrypted_content:'NATIVE_SIGNATURE_SENTINEL'});
          task.permissions.mode='full';task.followups.add('Queued text remains a draft');
          const panel=vb6Studio.documents.tools.get('tool:coding-agents');panel.prompt.value='UNSENT_DRAFT_SENTINEL';task.draft=panel.prompt.value;panel.refresh();
          return {id:task.id, archive:api.conversations.exportContext()};
        }""")

    def archive_roundtrip(page, mode):
        data = archive_seed(page)
        tab(page, 'Tasks')
        page.get_by_role('button', name='Export public context…', exact=True).click()
        dialog = page.get_by_role('dialog', name='AI Coding Agent — Export Public Context', exact=True)
        check('secrets you typed' in dialog.inner_text())
        with page.expect_download() as saved: dialog.get_by_role('button', name='Save File', exact=True).click()
        content = Path(saved.value.path()).read_text(); archive = json.loads(content)
        check(all(value not in content for value in ['TOOL_ARGUMENT_SENTINEL', 'TOOL_RESULT_SENTINEL', 'NATIVE_SIGNATURE_SENTINEL']))
        check(archive['draft'] == 'UNSENT_DRAFT_SENTINEL' and len(archive['queue']) == 1)
        upload(page, archive)
        dialog = page.get_by_role('dialog', name='AI Coding Agent — Import Reviewed Context', exact=True)
        check(not dialog.get_by_label('Import queued text into current project', exact=True).is_checked())
        dialog.get_by_label('Imported task name', exact=True).fill('Reviewed import')
        dialog.get_by_label('Reviewed imported task context', exact=True).fill('Reviewed public excerpt only.')
        dialog.get_by_label('Import queued text into current project', exact=True).check()
        dialog.get_by_role('button', name='Create New Task', exact=True).click(); finish(page)
        check(page.evaluate("vb6Studio.codingAgents.conversations.active.title==='Reviewed import' && vb6Studio.codingAgents.agent.usage.requests===0 && vb6Studio.codingAgents.agent.history.length===0"))
        check(page.evaluate("vb6Studio.codingAgents.conversations.active.permissions.mode==='review' && vb6Studio.codingAgents.conversations.active.followups.list().length===1"))
        check('Reviewed public excerpt only.' in page.get_by_label('Agent task', exact=True).input_value())
        check('UNSENT_DRAFT_SENTINEL' not in page.get_by_label('Agent task', exact=True).input_value())
        check(page.evaluate("id=>vb6Studio.codingAgents.conversations.tasks.get(id).draft==='UNSENT_DRAFT_SENTINEL'", data['id']))
        tab(page, 'Tasks'); page.get_by_role('button', name='Export Markdown…', exact=True).click()
        with page.expect_download() as markdown:
            page.get_by_role('dialog', name='AI Coding Agent — Export Public Context', exact=True).get_by_role('button', name='Save File', exact=True).click()
        check('# Reviewed import' in Path(markdown.value.path()).read_text())
        page.screenshot(path=str(reports / f'{mode}-reviewed-context.png'))
        return {'jsonAndMarkdownDownloads': True, 'explicitReview': True, 'freshTaskAndPermissions': True, 'queueOptIn': True, 'originalUnchanged': True}

    def archive_rejections(page, mode):
        data = archive_seed(page)
        invalid = {**data['archive'], 'permissions': {'mode': 'full'}}
        upload(page, invalid); finish(page)
        check('Invalid public task context archive' in page.locator('.agent-status').inner_text())
        check(page.evaluate('vb6Studio.codingAgents.conversations.tasks.size') == 1)
        upload(page, b'{invalid'); finish(page)
        check('not valid JSON' in page.locator('.agent-status').inner_text())
        page.evaluate("() => {window.fileReads=0;window.originalFileText=File.prototype.text;File.prototype.text=function(){window.fileReads++;return originalFileText.call(this);};}")
        upload(page, b' ' * (4 * 1024 * 1024 + 1)); finish(page)
        check('4 MiB' in page.locator('.agent-status').inner_text()); check(page.evaluate('fileReads') == 0)
        page.evaluate('() => { File.prototype.text=originalFileText; }')
        upload(page, data['archive'])
        page.get_by_role('dialog', name='AI Coding Agent — Import Reviewed Context', exact=True).get_by_role('button', name='Cancel', exact=True).click(); finish(page)
        check(page.evaluate('vb6Studio.codingAgents.conversations.tasks.size') == 1)
        check(page.evaluate('vb6Studio.codingAgents.agent.usage.requests') == 0)
        return {'unknownAuthorityRejected': True, 'malformedJsonRejected': True, 'byteCapBeforeRead': True, 'cancelAtomic': True}

    def archive_workspace_cancel(page, mode):
        data = archive_seed(page); upload(page, data['archive'])
        page.get_by_role('dialog', name='AI Coding Agent — Import Reviewed Context', exact=True).wait_for()
        page.evaluate("vb6Studio.loadProject(VB6StudioAPI.newProject('Import replacement'));true")
        page.wait_for_function("!document.querySelector('[aria-modal=true]')"); finish(page)
        check(page.evaluate("vb6Studio.project.name==='Import replacement' && vb6Studio.codingAgents.conversations.tasks.size===1 && vb6Studio.codingAgents.agent.usage.requests===0"))
        check(page.locator('.agent-panel').count() == 1)
        return {'reloadCancelsReview': True, 'noTaskOrRequestCreated': True}

    def fork_public_prefix(page, mode):
        data = archive_seed(page)
        page.locator('.agent-thread-entry').filter(has=page.get_by_text('Selected public answer', exact=True)).get_by_role('button', name='New task from this message', exact=True).click()
        dialog = page.get_by_role('dialog', name='AI Coding Agent — Import Reviewed Context', exact=True)
        context = dialog.get_by_label('Reviewed imported task context', exact=True).input_value()
        check('Earlier public question' in context and 'Selected public answer' in context)
        check(all(value not in context for value in ['FUTURE_MESSAGE_MUST_NOT_BE_FORKED', 'UNSENT_DRAFT_SENTINEL', 'NATIVE_SIGNATURE_SENTINEL', 'TOOL_RESULT_SENTINEL']))
        check(dialog.get_by_label('Import queued text into current project', exact=True).is_disabled())
        dialog.get_by_role('button', name='Create New Task', exact=True).click(); finish(page)
        check(page.evaluate('vb6Studio.codingAgents.conversations.tasks.size===2 && vb6Studio.codingAgents.agent.history.length===0 && vb6Studio.codingAgents.agent.usage.requests===0'))
        check(page.evaluate('id=>vb6Studio.codingAgents.conversations.activeId!==id', data['id']))
        return {'selectedPrefixOnly': True, 'noFutureMessagesOrDraft': True, 'freshReviewedTask': True}

    cases = {'cooperative-pause-' + provider: (lambda page, mode, provider=provider: paused_prefix(page, mode, provider)) for provider in ('openai', 'anthropic', 'google')}
    cases.update({'pause-stop-override': pause_then_stop, 'conversation-search': search_navigation, 'search-retention': search_retention,
                  'archive-roundtrip': archive_roundtrip, 'archive-rejections': archive_rejections, 'archive-workspace-cancel': archive_workspace_cancel, 'public-prefix-fork': fork_public_prefix})
    return cases
