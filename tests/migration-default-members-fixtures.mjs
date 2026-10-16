import {project} from './migration-fixtures.mjs';
export const DEFAULT_MEMBERS_FIXTURE=project(`Option Explicit
Public ReceiverCalls As Long
Public Sub Main()
Dim item As Counter
Set item=New Counter
item=7
Debug.Print item
Debug.Print item+3
Debug.Print CStr(item)
Debug.Print Len(CStr(item))
Debug.Print IsObject(item)
Debug.Print TypeOf item Is Counter
Dim other As Counter
Set other=item
Debug.Print item Is other
Debug.Print (item) Is (other)
Mutate other
Debug.Print item
With item
.Value=12
End With
Debug.Print item
Debug.Print item & "!"
If item Then Debug.Print "truth"
Dim callable As Callable
Set callable=New Callable
Debug.Print callable(3)
Debug.Print callable
Dim wrapper As Wrapper
Set wrapper=New Wrapper
Set wrapper.Child=item
Debug.Print wrapper
item=19
Debug.Print item
Debug.Print GetCounter(item)+1
Debug.Print ReceiverCalls
Dim selected As Counter
Set selected=GetCounter(item)
Debug.Print selected Is item
Debug.Print ReceiverCalls
Dim contract As CounterContract
Set contract=New CounterImplementation
contract=23
Debug.Print contract
End Sub
Private Sub Mutate(ByRef item As Counter)
item.Value=10
End Sub
Private Function GetCounter(ByVal item As Counter) As Counter
ReceiverCalls=ReceiverCalls+1
Set GetCounter=item
End Function`);
DEFAULT_MEMBERS_FIXTURE.name='DefaultMembers';
DEFAULT_MEMBERS_FIXTURE.modules.push(
{name:'Counter',kind:'class',code:`Option Explicit
Private stored As Long
Public Property Get Value() As Long
Value=stored
End Property
Public Property Let Value(ByVal rhs As Long)
stored=rhs
End Property
Attribute Value.VB_UserMemId=0`},
{name:'Callable',kind:'class',code:`Option Explicit
Public Function Evaluate(Optional ByVal n As Long=5) As Long
Evaluate=n*2
End Function
Attribute Evaluate.VB_UserMemId=0`},
{name:'Wrapper',kind:'class',code:`Option Explicit
Public Child As Counter
Public Property Get Value() As Counter
Set Value=Child
End Property
Attribute Value.VB_UserMemId=0`},
{name:'CounterContract',kind:'class',code:`Option Explicit
Public Property Get Value() As Long
End Property
Public Property Let Value(ByVal rhs As Long)
End Property
Attribute Value.VB_UserMemId=0`},
{name:'CounterImplementation',kind:'class',code:`Option Explicit
Implements CounterContract
Private stored As Long
Private Property Get CounterContract_Value() As Long
CounterContract_Value=stored
End Property
Private Property Let CounterContract_Value(ByVal rhs As Long)
stored=rhs
End Property`}
);
export const DEFAULT_MEMBERS_EXPECTED=['7','10','7','1','True','True','True','True','10','12','12!','truth','6','10','12','19','20','1','True','2','23'];
