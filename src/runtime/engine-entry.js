/** Headless engine for Quire. Compiler, virtual machine, values and Automation.
 *  Quire does not load ApplicationHost, the IDE, or the forms bundle from here. */
import { compileProject } from '../language/compiler.js';
import { VirtualMachine } from './vm.js';
import { AutomationRegistry } from './automation.js';
import { describe, unbox, NOTHING, MISSING } from './values.js';
import { VBError } from '../language/errors.js';

export { compileProject, VirtualMachine, AutomationRegistry, describe, unbox, NOTHING, MISSING, VBError };
