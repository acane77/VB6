# Read-only failure diagnostics for the original native test executable. The
# watchdog result is never replaced by the instrumented follow-up's outcome.
if (-not ('NativeFailureWindowsProbe' -as [type])) {
 Add-Type @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeFailureWindowsProbe {
 public delegate bool EnumProc(IntPtr window,IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr context);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint process);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)]
 static extern IntPtr TextMessage(IntPtr window,uint message,IntPtr capacity,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 public static string[] Read(int process) {
  var values=new List<string>();var watch=Stopwatch.StartNew();int remaining=64;
  EnumProc inspect=(window,context)=>{
   if(remaining--<=0||watch.ElapsedMilliseconds>=2000)return false;
   uint owner;GetWindowThreadProcessId(window,out owner);
   if(owner!=(uint)process)return true;
   var text=new StringBuilder(2048);UIntPtr result;
   var ok=TextMessage(window,13,(IntPtr)text.Capacity,text,2,100,out result);
   values.Add(window.ToInt64().ToString("X")+": "+(ok==IntPtr.Zero?"[text unavailable]":text.ToString()));
   return true;
  };
  EnumWindows((window,context)=>{
   if(remaining<=0||watch.ElapsedMilliseconds>=2000)return false;
   uint owner;GetWindowThreadProcessId(window,out owner);
   if(owner==(uint)process&&inspect(window,context))EnumChildWindows(window,inspect,IntPtr.Zero);
   return true;
  },IntPtr.Zero);
  return values.ToArray();
 }
}
'@
}
function Get-NativeProcessDiagnostics([Diagnostics.Process]$Process) {
 $result=[ordered]@{}
 try {
  $Process.Refresh()
  $result.processId=$Process.Id
  $result.hasExited=$Process.HasExited
  $result.processorMilliseconds=$Process.TotalProcessorTime.TotalMilliseconds
  $result.workingSetBytes=$Process.WorkingSet64
  if (-not $Process.HasExited) {$result.windows=@([NativeFailureWindowsProbe]::Read($Process.Id))}
 } catch {$result.diagnosticError=$_.Exception.Message}
 return $result
}
