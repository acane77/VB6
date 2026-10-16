Option Explicit
Sub Main()
    Dim cn As New ADODB.Connection, cmd As New ADODB.Command, rs As New ADODB.Recordset
    Dim first As Variant, last As Variant, bytes(0 To 1) As Byte, result As Variant
    cn.Open "Provider=SQLite;Data Source=/acceptance.sqlite"
    cn.Execute "CREATE TABLE customers(id INTEGER PRIMARY KEY, name TEXT)"
    cn.Execute "INSERT INTO customers VALUES(1,'Ada'),(2,'Grace')"
    Set cmd.ActiveConnection = cn
    cmd.CommandText = "SELECT name FROM customers WHERE id=?"
    cmd.Parameters.Append cmd.CreateParameter("id", adInteger, adParamInput, 0, 2)
    rs.Open cmd
    Debug.Print rs.Fields("name").Value
    rs.Close
    Set rs = cn.OpenSchema(adSchemaColumns, Array(Empty, Empty, "CUSTOMERS", "NAME"))
    Debug.Print rs.RecordCount, rs.Fields("DATA_TYPE").Value
    rs.Close
    Set rs = cn.OpenSchema(adSchemaPrimaryKeys, Array(Empty, Empty, "customers"))
    Debug.Print rs.Fields("COLUMN_NAME").Value
    cn.Close

    Set rs = New ADODB.Recordset
    rs.Fields.Append "id", adInteger
    rs.Fields.Append "memo", adLongVarWChar, 100, adFldLong
    rs.Fields.Append "payload", adLongVarBinary, 100, adFldLong
    rs.Open
    rs.AddNew Array("id", "memo"), Array(1, "original")
    rs.AddNew Array("id", "memo"), Array(2, "second")
    last = rs.Bookmark
    rs.MoveFirst
    first = rs.Bookmark
    Debug.Print rs.CompareBookmarks(first, last) = adCompareLessThan
    rs.Filter = "(id=1) OR (id=2 AND memo='second')"
    Debug.Print rs.RecordCount
    rs.Fields("memo").AppendChunk "ab"
    rs.Fields("memo").AppendChunk "cd"
    rs.Update
    Debug.Print rs.Fields("memo").GetChunk(2), rs.Fields("memo").GetChunk(2)
    bytes(0) = 7
    bytes(1) = 255
    rs.Fields("payload").AppendChunk bytes
    rs.Update
    result = rs.Fields("payload").Value
    Debug.Print TypeName(result), result(0), result(1)
    result(0) = 99
    result = rs("payload")
    Debug.Print result(0)
    rs.Find "id=1", 1, adSearchBackward, last
    Debug.Print rs.Fields("id").Value
    rs.Close
End Sub
