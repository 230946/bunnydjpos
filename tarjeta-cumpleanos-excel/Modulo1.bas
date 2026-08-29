Attribute VB_Name = "Modulo1"
Option Explicit

Private Const MM As Double = 2.83464567 ' puntos por milimetro
Private Const CARD_W As Double = 86 * MM
Private Const CARD_H As Double = 133 * MM
Private Const ESPACIO As Double = 4 * MM
Private Const MARGEN_HOJA As Double = 8 * MM

Sub GenerarTarjetas()
    Dim wsT As Worksheet, wsE As Worksheet, wsC As Worksheet, wsD As Worksheet, wsA As Worksheet
    Set wsT = ThisWorkbook.Sheets("Tarjetas")
    Set wsE = ThisWorkbook.Sheets("Empleados")
    Set wsC = ThisWorkbook.Sheets("Config")
    Set wsD = ThisWorkbook.Sheets("Datos")
    Set wsA = ThisWorkbook.Sheets("Assets")

    Application.ScreenUpdating = False

    Dim shp As Shape
    Do While wsT.Shapes.Count > 0
        wsT.Shapes(1).Delete
    Loop

    Dim disenoNombre As String: disenoNombre = Trim(wsC.Range("B2").Value)
    Dim colorTexto As String: colorTexto = Trim(wsC.Range("B3").Value)
    Dim opacidad As Double
    If IsNumeric(wsC.Range("B4").Value) Then opacidad = wsC.Range("B4").Value / 100 Else opacidad = 0.9
    Dim diaTxt As String: diaTxt = wsC.Range("B5").Value
    Dim fechaTxt As String: fechaTxt = wsC.Range("B6").Value
    Dim horaTxt As String: horaTxt = wsC.Range("B7").Value
    Dim lugarTxt As String: lugarTxt = wsC.Range("B8").Value
    Dim tituloTxt As String: tituloTxt = wsC.Range("B9").Value
    Dim parrafoTxt As String: parrafoTxt = wsC.Range("B10").Value

    Dim imgShapeName As String, esMarco As Boolean, encontrado As Boolean
    encontrado = False
    Dim ultimaFilaD As Long: ultimaFilaD = wsD.Cells(wsD.Rows.Count, 1).End(xlUp).Row
    Dim i As Long
    For i = 2 To ultimaFilaD
        If Trim(wsD.Cells(i, 1).Value) = disenoNombre Then
            imgShapeName = wsD.Cells(i, 2).Value
            esMarco = CBool(wsD.Cells(i, 3).Value)
            encontrado = True
            Exit For
        End If
    Next i
    If Not encontrado Then
        MsgBox "No encuentro el diseno '" & disenoNombre & "' en la hoja Datos.", vbExclamation
        Application.ScreenUpdating = True
        Exit Sub
    End If

    Dim filtroArea As String: filtroArea = Trim(wsC.Range("B13").Value)
    Dim filtroSuper As String: filtroSuper = Trim(wsC.Range("B14").Value)
    Dim filtroMes As String: filtroMes = Trim(wsC.Range("B15").Value)

    Dim ultimaFilaE As Long: ultimaFilaE = wsE.Cells(wsE.Rows.Count, 1).End(xlUp).Row
    Dim nombres As Collection: Set nombres = New Collection
    For i = 2 To ultimaFilaE
        If Trim(wsE.Cells(i, 1).Value) <> "" Then
            If (filtroArea = "" Or wsE.Cells(i, 2).Value = filtroArea) _
            And (filtroSuper = "" Or wsE.Cells(i, 3).Value = filtroSuper) _
            And (filtroMes = "" Or CStr(wsE.Cells(i, 5).Value) = filtroMes) Then
                nombres.Add wsE.Cells(i, 1).Value
            End If
        End If
    Next i
    If nombres.Count = 0 Then nombres.Add "" ' al menos una tarjeta de muestra

    Dim rgbTexto As Long: rgbTexto = ColorDesdeNombre(colorTexto)
    If esMarco And colorTexto = "Blanco" Then rgbTexto = RGB(34, 34, 34)

    Dim idx As Long: idx = 0
    Dim nombreEmp As Variant
    For Each nombreEmp In nombres
        Dim col As Long, fila As Long, pagina As Long
        col = idx Mod 2
        fila = (idx \ 2) Mod 2
        pagina = idx \ 4
        Dim x0 As Double, y0 As Double
        x0 = MARGEN_HOJA + col * (CARD_W + ESPACIO)
        y0 = MARGEN_HOJA + fila * (CARD_H + ESPACIO) + pagina * (2 * CARD_H + ESPACIO + 20 * MM)

        DibujarTarjeta wsT, wsA, x0, y0, imgShapeName, esMarco, rgbTexto, opacidad, _
            tituloTxt, parrafoTxt, diaTxt, fechaTxt, horaTxt, lugarTxt, CStr(nombreEmp)
        idx = idx + 1
    Next nombreEmp

    ConfigurarImpresion wsT, idx

    Application.ScreenUpdating = True
    MsgBox nombres.Count & " tarjeta(s) generada(s) en la hoja 'Tarjetas'.", vbInformation
End Sub

Private Function ColorDesdeNombre(nombre As String) As Long
    Select Case nombre
        Case "Blanco": ColorDesdeNombre = RGB(255, 255, 255)
        Case "Negro": ColorDesdeNombre = RGB(34, 34, 34)
        Case "Rojo": ColorDesdeNombre = RGB(161, 10, 10)
        Case "Dorado": ColorDesdeNombre = RGB(212, 175, 55)
        Case "Azul": ColorDesdeNombre = RGB(10, 74, 161)
        Case Else: ColorDesdeNombre = RGB(34, 34, 34)
    End Select
End Function

Private Function DuplicarAsset(wsA As Worksheet, wsT As Worksheet, nombreShape As String) As Shape
    Dim origen As Shape
    Set origen = wsA.Shapes(nombreShape)
    origen.Copy
    wsT.Paste
    Set DuplicarAsset = wsT.Shapes(wsT.Shapes.Count)
End Function

Private Sub DibujarTarjeta(wsT As Worksheet, wsA As Worksheet, x0 As Double, y0 As Double, _
    imgShapeName As String, esMarco As Boolean, rgbTexto As Long, opacidad As Double, _
    tituloTxt As String, parrafoTxt As String, diaTxt As String, fechaTxt As String, _
    horaTxt As String, lugarTxt As String, nombreEmpleado As String)

    Dim pic As Shape
    Set pic = DuplicarAsset(wsA, wsT, imgShapeName)
    pic.LockAspectRatio = msoFalse
    pic.Left = x0: pic.Top = y0
    pic.Width = CARD_W: pic.Height = CARD_H
    pic.Name = "fondo_" & wsT.Shapes.Count

    Dim padLR As Double: padLR = (IIf(esMarco, 9, 3) / 100) * CARD_W
    Dim padTop As Double: padTop = 0.05 * CARD_H
    Dim padBottom As Double: padBottom = 0.03 * CARD_H
    Dim boxL As Double, boxT As Double, boxW As Double, boxH As Double
    boxL = x0 + padLR
    boxT = y0 + padTop
    boxW = CARD_W - 2 * padLR
    boxH = CARD_H - padTop - padBottom

    Dim box As Shape
    Set box = wsT.Shapes.AddShape(msoShapeRoundedRectangle, boxL, boxT, boxW, boxH)
    box.Adjustments.Item(1) = 0.04
    box.Fill.ForeColor.RGB = RGB(255, 255, 255)
    box.Fill.Transparency = 1 - opacidad
    box.Line.Visible = msoFalse
    box.Shadow.Visible = msoFalse

    Dim titH As Double: titH = 24 * MM
    Dim tit As Shape
    Set tit = wsT.Shapes.AddTextbox(msoTextOrientationHorizontal, boxL, boxT + 2 * MM, boxW, titH)
    ConfigurarTexto tit, tituloTxt, "Impact", 22, True, RGB(17, 17, 17), msoAlignCenter
    AjustarSiNoCabe tit, titH, 12

    Dim parrafoProcesado As String
    parrafoProcesado = Replace(parrafoTxt, "{dia}", diaTxt)
    parrafoProcesado = Replace(parrafoProcesado, "{fecha}", UCase(fechaTxt))
    parrafoProcesado = Replace(parrafoProcesado, "{hora}", LCase(horaTxt))
    parrafoProcesado = Replace(parrafoProcesado, "{lugar}", LCase(lugarTxt))

    Dim parH As Double: parH = 0.34 * CARD_H
    Dim par As Shape
    Set par = wsT.Shapes.AddTextbox(msoTextOrientationHorizontal, boxL + 4 * MM, boxT + titH + 3 * MM, boxW - 8 * MM, parH)
    ConfigurarTexto par, parrafoProcesado, "Georgia", 10, False, RGB(17, 17, 17), msoAlignJustify

    Dim yInfo As Double: yInfo = boxT + titH + parH + 4 * MM

    ' Nombre: hasta 2 lineas (no se corta un nombre largo)
    Dim nameShp As Shape
    Set nameShp = wsT.Shapes.AddTextbox(msoTextOrientationHorizontal, boxL + 4 * MM, yInfo, boxW - 8 * MM, 11 * MM)
    ConfigurarTexto nameShp, UCase(nombreEmpleado), "Arial", 13, True, rgbTexto, msoAlignLeft
    AjustarSiNoCabe nameShp, 11 * MM, 8

    Dim infoTxt As String
    infoTxt = "Fecha : " & fechaTxt & vbLf & "Hora: " & horaTxt & vbLf & "Lugar : " & lugarTxt
    Dim infoShp As Shape
    Set infoShp = wsT.Shapes.AddTextbox(msoTextOrientationHorizontal, boxL + 4 * MM, yInfo + 13 * MM, boxW - 8 * MM, 16 * MM)
    ConfigurarTexto infoShp, infoTxt, "Arial", 11, True, rgbTexto, msoAlignLeft

    Dim logoPic As Shape
    Set logoPic = DuplicarAsset(wsA, wsT, "img_logo")
    logoPic.LockAspectRatio = msoTrue
    logoPic.Width = 16 * MM
    logoPic.Left = x0 + (CARD_W - logoPic.Width) / 2
    logoPic.Top = yInfo + 31 * MM
    logoPic.Name = "logo_" & wsT.Shapes.Count
End Sub

Private Sub ConfigurarTexto(shp As Shape, texto As String, fuente As String, tam As Double, _
    negrita As Boolean, colorRGB As Long, alineacion As Long)
    With shp.TextFrame2.TextRange
        .Text = texto
        .Font.Name = fuente
        .Font.Size = tam
        .Font.Bold = negrita
        .Font.Fill.ForeColor.RGB = colorRGB
        .ParagraphFormat.Alignment = alineacion
    End With
    shp.TextFrame2.WordWrap = msoTrue
    shp.TextFrame2.AutoSize = msoAutoSizeNone
    shp.TextFrame.MarginLeft = 0
    shp.TextFrame.MarginRight = 0
    shp.TextFrame.MarginTop = 0
    shp.TextFrame.MarginBottom = 0
    shp.Fill.Visible = msoFalse
    shp.Line.Visible = msoFalse
End Sub

' Si el texto no cabe en el alto asignado, Excel oculta la linea completa que
' sobra (no la recorta a la mitad). Para evitar que desaparezca texto, si no
' cabe se reduce el tamano de letra gradualmente hasta que quepa.
Private Sub AjustarSiNoCabe(shp As Shape, alturaMax As Double, tamMinimo As Double)
    Dim intentos As Integer: intentos = 0
    shp.TextFrame2.AutoSize = msoAutoSizeShapeToFitText
    Do While shp.Height > alturaMax And shp.TextFrame2.TextRange.Font.Size > tamMinimo And intentos < 30
        shp.TextFrame2.TextRange.Font.Size = shp.TextFrame2.TextRange.Font.Size - 0.5
        intentos = intentos + 1
    Loop
    shp.TextFrame2.AutoSize = msoAutoSizeNone
    shp.Height = alturaMax
End Sub

Private Sub ConfigurarImpresion(ws As Worksheet, cantidad As Long)
    Dim paginas As Long: paginas = Int((cantidad - 1) / 4) + 1
    If cantidad = 0 Then paginas = 1

    Dim maxRow As Long: maxRow = 1
    Do While ws.Rows(maxRow).Top < (MARGEN_HOJA + paginas * (2 * CARD_H + ESPACIO + 20 * MM)) And maxRow < 3000
        maxRow = maxRow + 1
    Loop
    Dim maxCol As Long: maxCol = 1
    Do While ws.Columns(maxCol).Left < (MARGEN_HOJA + 2 * CARD_W + ESPACIO + MARGEN_HOJA) And maxCol < 200
        maxCol = maxCol + 1
    Loop

    ws.PageSetup.PrintArea = ws.Range(ws.Cells(1, 1), ws.Cells(maxRow, maxCol)).Address
    ws.PageSetup.Orientation = xlPortrait
    ws.PageSetup.PaperSize = xlPaperA4
    ws.PageSetup.Zoom = 100
    ws.PageSetup.LeftMargin = 0: ws.PageSetup.RightMargin = 0
    ws.PageSetup.TopMargin = 0: ws.PageSetup.BottomMargin = 0
    ws.PageSetup.CenterHorizontally = False

    Dim hpb As HPageBreak
    For Each hpb In ws.HPageBreaks
        hpb.Delete
    Next hpb

    Dim p As Long
    For p = 1 To paginas - 1
        Dim yCorte As Double: yCorte = MARGEN_HOJA + p * (2 * CARD_H + ESPACIO + 20 * MM) - 10 * MM
        Dim r As Long: r = 1
        Do While ws.Rows(r).Top < yCorte And r < maxRow
            r = r + 1
        Loop
        On Error Resume Next
        ws.HPageBreaks.Add Before:=ws.Rows(r)
        On Error GoTo 0
    Next p
End Sub

Sub ImprimirTarjetas()
    ThisWorkbook.Sheets("Tarjetas").PrintPreview
End Sub

Sub ExportarEmpleadosCSV()
    Dim wsE As Worksheet: Set wsE = ThisWorkbook.Sheets("Empleados")
    Dim ultimaFila As Long: ultimaFila = wsE.Cells(wsE.Rows.Count, 1).End(xlUp).Row
    If ultimaFila < 2 Then
        MsgBox "No hay empleados para exportar.", vbExclamation
        Exit Sub
    End If

    Dim rutaArchivo As Variant
    rutaArchivo = Application.GetSaveAsFilename( _
        InitialFileName:="empleados-cumpleanos.csv", _
        FileFilter:="Archivo CSV (*.csv), *.csv")
    If rutaArchivo = False Then Exit Sub

    Dim numArchivo As Integer: numArchivo = FreeFile
    Open rutaArchivo For Output As #numArchivo
    Print #numArchivo, Chr(239) & Chr(187) & Chr(191) & "Nombre,Area,Supervisor,Dia,Mes,Fecha"
    Dim i As Long
    For i = 2 To ultimaFila
        If Trim(wsE.Cells(i, 1).Value) <> "" Then
            Dim fecha As String
            fecha = Format(wsE.Cells(i, 4).Value, "00") & "/" & Format(wsE.Cells(i, 5).Value, "00")
            Print #numArchivo, CSVEscapar(wsE.Cells(i, 1).Value) & "," & CSVEscapar(wsE.Cells(i, 2).Value) & "," & _
                CSVEscapar(wsE.Cells(i, 3).Value) & "," & wsE.Cells(i, 4).Value & "," & wsE.Cells(i, 5).Value & "," & fecha
        End If
    Next i
    Close #numArchivo
    MsgBox "Exportado correctamente a:" & vbLf & rutaArchivo, vbInformation
End Sub

Private Function CSVEscapar(valor As Variant) As String
    Dim t As String: t = CStr(valor)
    If InStr(t, ",") > 0 Or InStr(t, """") > 0 Then
        t = """" & Replace(t, """", """""") & """"
    End If
    CSVEscapar = t
End Function

Sub ImportarEmpleadosCSV()
    Dim rutaArchivo As Variant
    rutaArchivo = Application.GetOpenFilename("Archivo CSV (*.csv), *.csv")
    If rutaArchivo = False Then Exit Sub

    Dim numArchivo As Integer: numArchivo = FreeFile
    Dim linea As String
    Dim encabezado() As String
    Dim primeraLinea As Boolean: primeraLinea = True
    Dim iNombre As Long, iArea As Long, iSuper As Long, iDia As Long, iMes As Long, iFecha As Long
    iNombre = -1: iArea = -1: iSuper = -1: iDia = -1: iMes = -1: iFecha = -1

    Dim wsE As Worksheet: Set wsE = ThisWorkbook.Sheets("Empleados")
    Dim filaDestino As Long: filaDestino = wsE.Cells(wsE.Rows.Count, 1).End(xlUp).Row + 1
    If filaDestino < 2 Then filaDestino = 2

    Dim respuesta As VbMsgBoxResult
    If wsE.Cells(2, 1).Value <> "" Then
        respuesta = MsgBox("Ya hay empleados en la lista." & vbLf & vbLf & _
            "Si = reemplazar todo con el archivo importado." & vbLf & "No = agregar al final.", vbYesNoCancel)
        If respuesta = vbCancel Then Exit Sub
        If respuesta = vbYes Then
            wsE.Range("A2:E" & wsE.Rows.Count).ClearContents
            filaDestino = 2
        End If
    End If

    Open rutaArchivo For Input As #numArchivo
    Do While Not EOF(numArchivo)
        Line Input #numArchivo, linea
        linea = Replace(linea, Chr(239) & Chr(187) & Chr(191), "") ' quita BOM si viene
        If Trim(linea) = "" Then GoTo SiguienteLinea

        Dim sep As String
        If InStr(linea, ";") > 0 And InStr(linea, ",") = 0 Then sep = ";" Else sep = ","
        Dim campos() As String: campos = DividirCSV(linea, sep)

        If primeraLinea Then
            Dim j As Long
            For j = 0 To UBound(campos)
                Dim h As String: h = NormalizarTexto(campos(j))
                If h = "nombre" Or h = "nombre completo" Or h = "empleado" Then iNombre = j
                If h = "area" Then iArea = j
                If h = "supervisor" Or h = "jefe" Then iSuper = j
                If h = "dia" Then iDia = j
                If h = "mes" Then iMes = j
                If h = "fecha" Or h = "cumpleanos" Or h = "fecha de nacimiento" Then iFecha = j
            Next j
            primeraLinea = False
        Else
            If iNombre >= 0 And iNombre <= UBound(campos) And Trim(campos(iNombre)) <> "" Then
                Dim nombreEmp As String: nombreEmp = Trim(campos(iNombre))
                Dim areaEmp As String: areaEmp = ""
                Dim superEmp As String: superEmp = ""
                Dim diaEmp As Long: diaEmp = 0
                Dim mesEmp As Long: mesEmp = 0
                If iArea >= 0 And iArea <= UBound(campos) Then areaEmp = Trim(campos(iArea))
                If iSuper >= 0 And iSuper <= UBound(campos) Then superEmp = Trim(campos(iSuper))

                If iDia >= 0 And iMes >= 0 And iDia <= UBound(campos) And iMes <= UBound(campos) _
                   And Trim(campos(iDia)) <> "" And Trim(campos(iMes)) <> "" Then
                    diaEmp = Val(campos(iDia))
                    mesEmp = MesDesdeTexto(campos(iMes))
                ElseIf iFecha >= 0 And iFecha <= UBound(campos) And Trim(campos(iFecha)) <> "" Then
                    ParsearFecha Trim(campos(iFecha)), diaEmp, mesEmp
                End If

                If diaEmp >= 1 And diaEmp <= 31 And mesEmp >= 1 And mesEmp <= 12 Then
                    wsE.Cells(filaDestino, 1).Value = nombreEmp
                    wsE.Cells(filaDestino, 2).Value = areaEmp
                    wsE.Cells(filaDestino, 3).Value = superEmp
                    wsE.Cells(filaDestino, 4).Value = diaEmp
                    wsE.Cells(filaDestino, 5).Value = mesEmp
                    filaDestino = filaDestino + 1
                End If
            End If
        End If
SiguienteLinea:
    Loop
    Close #numArchivo

    MsgBox "Importacion completada.", vbInformation
End Sub

Private Function DividirCSV(linea As String, sep As String) As String()
    Dim resultado() As String
    Dim n As Long: n = 0
    ReDim resultado(0 To 50)
    Dim campo As String: campo = ""
    Dim entreComillas As Boolean: entreComillas = False
    Dim i As Long
    For i = 1 To Len(linea)
        Dim c As String: c = Mid(linea, i, 1)
        If entreComillas Then
            If c = """" Then
                If Mid(linea, i + 1, 1) = """" Then
                    campo = campo & """"
                    i = i + 1
                Else
                    entreComillas = False
                End If
            Else
                campo = campo & c
            End If
        ElseIf c = """" Then
            entreComillas = True
        ElseIf c = sep Then
            resultado(n) = campo: n = n + 1
            If n > UBound(resultado) Then ReDim Preserve resultado(0 To n + 20)
            campo = ""
        Else
            campo = campo & c
        End If
    Next i
    resultado(n) = campo
    ReDim Preserve resultado(0 To n)
    DividirCSV = resultado
End Function

Private Function NormalizarTexto(t As String) As String
    Dim s As String: s = LCase(Trim(t))
    s = Replace(s, "á", "a"): s = Replace(s, "é", "e"): s = Replace(s, "í", "i")
    s = Replace(s, "ó", "o"): s = Replace(s, "ú", "u"): s = Replace(s, "ñ", "n")
    NormalizarTexto = s
End Function

Private Function MesDesdeTexto(t As String) As Long
    Dim limpio As String: limpio = NormalizarTexto(t)
    If IsNumeric(limpio) Then
        MesDesdeTexto = CLng(limpio)
        Exit Function
    End If
    Dim meses(1 To 12) As String
    meses(1) = "ene": meses(2) = "feb": meses(3) = "mar": meses(4) = "abr"
    meses(5) = "may": meses(6) = "jun": meses(7) = "jul": meses(8) = "ago"
    meses(9) = "sep": meses(10) = "oct": meses(11) = "nov": meses(12) = "dic"
    Dim i As Long
    For i = 1 To 12
        If Left(limpio, 3) = meses(i) Then
            MesDesdeTexto = i
            Exit Function
        End If
    Next i
    MesDesdeTexto = 0
End Function

Private Sub ParsearFecha(valor As String, ByRef dia As Long, ByRef mes As Long)
    dia = 0: mes = 0
    Dim partes() As String
    If InStr(valor, "/") > 0 Then
        partes = Split(valor, "/")
        If UBound(partes) >= 1 Then dia = Val(partes(0)): mes = Val(partes(1))
    ElseIf InStr(valor, "-") > 0 Then
        partes = Split(valor, "-")
        If UBound(partes) >= 2 Then ' aaaa-mm-dd
            dia = Val(partes(2)): mes = Val(partes(1))
        End If
    ElseIf InStr(NormalizarTexto(valor), " de ") > 0 Then
        Dim p2() As String: p2 = Split(NormalizarTexto(valor), " de ")
        dia = Val(p2(0))
        If UBound(p2) >= 1 Then mes = MesDesdeTexto(p2(1))
    End If
End Sub
