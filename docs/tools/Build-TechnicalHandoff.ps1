param(
  [string]$Source = (Join-Path $PSScriptRoot '../PC49-UI-UX-Technical-Handoff-2026-09-05.md'),
  [string]$Destination = (Join-Path $PSScriptRoot '../PC49-UI-UX-Technical-Handoff-2026-09-05.docx')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$sourcePath = [IO.Path]::GetFullPath($Source)
$outputPath = [IO.Path]::GetFullPath($Destination)
$utf8 = New-Object Text.UTF8Encoding($false)
$lines = [IO.File]::ReadAllLines($sourcePath, [Text.Encoding]::UTF8)
$body = New-Object Text.StringBuilder
$parts = [ordered]@{}
$headingCount = 0
$tableCount = 0
$bulletCount = 0
$paragraphCount = 0
$bookmarks = New-Object 'System.Collections.Generic.List[string]'

# compact_reference_guide, memo_masthead.
# Named overrides: Title 28 pt ink blue; Subtitle 12 pt muted; Metadata 9.5 pt;
# TableText 10 pt/1.15; SourceText 9 pt/1.15, path break opportunities;
# Header/Footer 9 pt, no decorative rules. All other tokens follow the preset.
function Escape-Xml([string]$value) {
  return [Security.SecurityElement]::Escape($value)
}

function Run-Xml([string]$value, [string]$properties = '') {
  $safe = Escape-Xml $value
  return '<w:r><w:rPr>' + $properties + '</w:rPr><w:t xml:space="preserve">' + $safe + '</w:t></w:r>'
}

function Paragraph-Xml([string]$value, [string]$style = 'Normal', [string]$extra = '') {
  return '<w:p><w:pPr><w:pStyle w:val="' + $style + '"/>' + $extra + '</w:pPr>' + (Run-Xml $value) + '</w:p>'
}

function Add-Paragraph([string]$value, [string]$style = 'Normal', [string]$extra = '') {
  [void]$body.Append((Paragraph-Xml $value $style $extra))
  $script:paragraphCount++
}

function Numbering-Xml([int]$id, [int]$level = 0) {
  return '<w:numPr><w:ilvl w:val="' + $level + '"/><w:numId w:val="' + $id + '"/></w:numPr>'
}

function Add-Heading([string]$text, [int]$level, [string]$anchor) {
  $script:headingCount++
  $id = $script:headingCount
  $numbered = $text -match '^\d+(?:\.\d+)*\.?\s+'
  $clean = if ($numbered) { $text -replace '^\d+(?:\.\d+)*\.?\s+', '' } else { $text }
  $props = if ($numbered) { Numbering-Xml 3 ($level - 1) } else { '' }
  $xml = '<w:p><w:pPr><w:pStyle w:val="Heading' + $level + '"/>' + $props + '</w:pPr>'
  $xml += '<w:bookmarkStart w:id="' + $id + '" w:name="' + $anchor + '"/>'
  $xml += Run-Xml $clean
  $xml += '<w:bookmarkEnd w:id="' + $id + '"/></w:p>'
  [void]$body.Append($xml)
  $bookmarks.Add($anchor)
}

function Add-Table([string[]]$tableLines) {
  $rows = @()
  foreach ($line in $tableLines) {
    if ($line -match '^\|[\s:|\-]+\|$') { continue }
    $cells = @($line.Trim().Trim('|').Split('|') | ForEach-Object { $_.Trim() })
    $rows += ,$cells
  }
  $count = $rows[0].Count
  $first = $rows[0][0]
  if ($count -eq 3) {
    if ($first -eq 'ID') { $widths = @(900, 4050, 4410) }
    elseif ($first -like 'Message*') { $widths = @(2600, 3150, 3610) }
    elseif ($first -eq 'State') { $widths = @(1450, 3650, 4260) }
    else { $widths = @(2800, 3280, 3280) }
  } elseif ($count -eq 4) {
    $widths = @(900, 4300, 2240, 1920)
  } else {
    throw "No width pattern for $count columns"
  }
  $tbl = New-Object Text.StringBuilder
  [void]$tbl.Append('<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tblCellMar><w:tblBorders>')
  foreach ($edge in @('top','left','bottom','right','insideH','insideV')) {
    [void]$tbl.Append('<w:' + $edge + ' w:val="single" w:sz="4" w:color="CBD5E1"/>')
  }
  [void]$tbl.Append('</w:tblBorders></w:tblPr><w:tblGrid>')
  foreach ($width in $widths) { [void]$tbl.Append('<w:gridCol w:w="' + $width + '"/>') }
  [void]$tbl.Append('</w:tblGrid>')
  for ($rowIndex = 0; $rowIndex -lt $rows.Count; $rowIndex++) {
    if ($rows[$rowIndex].Count -ne $count) { throw 'Unequal table row width' }
    [void]$tbl.Append('<w:tr><w:trPr><w:cantSplit/>')
    if ($rowIndex -eq 0) { [void]$tbl.Append('<w:tblHeader/>') }
    [void]$tbl.Append('</w:trPr>')
    for ($colIndex = 0; $colIndex -lt $count; $colIndex++) {
      [void]$tbl.Append('<w:tc><w:tcPr><w:tcW w:w="' + $widths[$colIndex] + '" w:type="dxa"/><w:vAlign w:val="center"/>')
      if ($rowIndex -eq 0) { [void]$tbl.Append('<w:shd w:val="clear" w:fill="E8EEF5"/>') }
      [void]$tbl.Append('</w:tcPr>')
      $cellProps = if ($colIndex -eq 0 -and $first -in @('ID','Ticket','State')) { '<w:jc w:val="center"/>' } else { '' }
      if ($rowIndex -eq 0) { $cellProps += '<w:keepNext/>' }
      $runProps = if ($rowIndex -eq 0) { '<w:b/>' } else { '' }
      [void]$tbl.Append('<w:p><w:pPr><w:pStyle w:val="TableText"/>' + $cellProps + '</w:pPr>' + (Run-Xml $rows[$rowIndex][$colIndex] $runProps) + '</w:p></w:tc>')
    }
    [void]$tbl.Append('</w:tr>')
  }
  [void]$tbl.Append('</w:tbl>')
  [void]$body.Append($tbl.ToString())
  $script:tableCount++
}

# Title block uses semantic Word styles; no fake layout table.
$intro = @($lines | Select-Object -First 9 | Where-Object { $_.Trim() })
Add-Paragraph 'PC49' 'Kicker'
Add-Paragraph 'Đặc tả cải thiện giao diện và độ tin cậy thao tác' 'Title'
Add-Paragraph $intro[1] 'Subtitle'
Add-Paragraph $intro[2] 'Metadata'
Add-Paragraph $intro[3] 'Metadata'
Add-Paragraph 'BẢN BÀN GIAO KỸ THUẬT' 'Kicker'
Add-Paragraph 'Thiết kế hành vi, hợp đồng dữ liệu, kế hoạch triển khai và tiêu chí nghiệm thu cho đội phát triển PC49.' 'Lead'
Add-Paragraph 'Phạm vi: giao diện nghiệp vụ và các thay đổi backend cần thiết để thao tác lưu/sửa đáng tin cậy. Các giải pháp trong tài liệu là đề xuất triển khai, chưa phải chức năng đã hoàn thành.' 'Normal'
Add-Paragraph 'Hướng đọc: Tech Lead dùng mục 2–4 và 15–18; Frontend dùng mục 5–12; Backend dùng mục 4, 6, 7, 13; QA dùng mục 14 và tiêu chí trong từng luồng.' 'Normal'
Add-Paragraph 'Mục lục' 'TOCHeading' '<w:pageBreakBefore/>'
$sectionIndex = 0
foreach ($line in $lines) {
  if ($line -match '^## (.+)$') {
    $sectionIndex++
    $label = $Matches[1]
    $toc = '<w:p><w:pPr><w:pStyle w:val="TOCEntry"/></w:pPr><w:hyperlink w:anchor="sec_' + $sectionIndex + '" w:history="1">'
    $toc += Run-Xml $label '<w:rStyle w:val="Hyperlink"/>'
    $toc += '</w:hyperlink></w:p>'
    [void]$body.Append($toc)
  }
}
Add-Paragraph 'Mục lục có liên kết nội bộ. Sử dụng Navigation Pane của Word để duyệt các tiểu mục.' 'Metadata'
$sectionIndex = 0
$subIndex = 0
$inMain = $false
for ($i = 0; $i -lt $lines.Length; $i++) {
  $line = $lines[$i]
  if ($line -match '^## (.+)$') {
    $sectionIndex++
    $subIndex = 0
    if (-not $inMain) {
      [void]$body.Append('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:br w:type="page"/></w:r></w:p>')
    }
    $inMain = $true
    Add-Heading $Matches[1] 1 ('sec_' + $sectionIndex)
    continue
  }
  if (-not $inMain -or -not $line.Trim()) { continue }
  if ($line -match '^### (.+)$') {
    $subIndex++
    Add-Heading $Matches[1] 2 ('sub_' + $sectionIndex + '_' + $subIndex)
    continue
  }
  if ($line.StartsWith('|')) {
    $tableLines = New-Object 'System.Collections.Generic.List[string]'
    while ($i -lt $lines.Length -and $lines[$i].StartsWith('|')) {
      $tableLines.Add($lines[$i]); $i++
    }
    $i--
    Add-Table $tableLines.ToArray()
    continue
  }
  if ($line.StartsWith('- ')) {
    $style = if ($sectionIndex -eq 19) { 'SourceText' } else { 'Bullet' }
    Add-Paragraph $line.Substring(2) $style (Numbering-Xml 1)
    $bulletCount++
  } else {
    Add-Paragraph $line
  }
}

$sectionXml = '<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="720"/></w:sectPr>'
$parts['word/document.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>' + $body.ToString() + $sectionXml + '</w:body></w:document>'

function Style-Xml([string]$id, [string]$name, [int]$size, [string]$color, [int]$before, [int]$after, [int]$line, [bool]$bold = $false, [string]$additional = '') {
  $outline = if ($id -match '^Heading([123])$') { '<w:outlineLvl w:val="' + ([int]$Matches[1] - 1) + '"/><w:keepNext/><w:keepLines/>' } else { '' }
  $boldXml = if ($bold) { '<w:b/>' } else { '<w:b w:val="0"/>' }
  return '<w:style w:type="paragraph" w:styleId="' + $id + '"><w:name w:val="' + $name + '"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:widowControl/><w:spacing w:before="' + $before + '" w:after="' + $after + '" w:line="' + $line + '" w:lineRule="auto"/>' + $outline + $additional + '</w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="' + $size + '"/><w:szCs w:val="' + $size + '"/><w:color w:val="' + $color + '"/>' + $boldXml + '<w:lang w:val="vi-VN"/></w:rPr></w:style>'
}
$styles = '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="vi-VN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>'
$styles += '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="left"/><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="202938"/><w:lang w:val="vi-VN"/></w:rPr></w:style>'
$styles += Style-Xml 'Title' 'Title' 56 '0B2545' 0 160 264 $true '<w:keepNext/>'
$styles += Style-Xml 'Subtitle' 'Subtitle' 24 '475569' 0 240 280 $false '<w:keepNext/>'
$styles += Style-Xml 'Heading1' 'heading 1' 32 '2E74B5' 360 200 300 $true
$styles += Style-Xml 'Heading2' 'heading 2' 26 '2E74B5' 280 140 300 $true
$styles += Style-Xml 'Heading3' 'heading 3' 24 '1F4D78' 200 100 300 $true
$styles += Style-Xml 'Bullet' 'Bullet' 22 '202938' 0 80 300 $false '<w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="271"/>'
$styles += Style-Xml 'TableText' 'Table text' 20 '202938' 0 60 276
$styles += Style-Xml 'Metadata' 'Metadata' 19 '475569' 0 60 276
$styles += Style-Xml 'Kicker' 'Kicker' 20 '1F4D78' 180 100 276 $true '<w:keepNext/>'
$styles += Style-Xml 'Lead' 'Lead' 24 '0B2545' 0 140 300
$styles += Style-Xml 'TOCHeading' 'Contents heading' 32 '2E74B5' 0 200 300 $true '<w:keepNext/>'
$styles += Style-Xml 'TOCEntry' 'Contents entry' 22 '1F4D78' 0 80 280
$styles += Style-Xml 'SourceText' 'Source text' 18 '475569' 0 80 276 $false '<w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="271"/>'
$styles += Style-Xml 'Header' 'Header' 18 '64748B' 0 0 240
$styles += Style-Xml 'Footer' 'Footer' 18 '64748B' 0 0 240 $false '<w:jc w:val="right"/>'
$styles += '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1F4D78"/></w:rPr></w:style></w:styles>'
$parts['word/styles.xml'] = $styles
$numbering = '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
foreach ($def in @(@(1,'bullet','•'), @(2,'decimal','%1.'))) {
  $numbering += '<w:abstractNum w:abstractNumId="' + $def[0] + '"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="' + $def[1] + '"/><w:lvlText w:val="' + $def[2] + '"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/><w:ind w:left="540" w:hanging="271"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr></w:lvl></w:abstractNum>'
}
$numbering += '<w:abstractNum w:abstractNumId="3"><w:multiLevelType w:val="multilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="480"/></w:tabs><w:ind w:left="480" w:hanging="480"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlRestart w:val="1"/><w:lvlText w:val="%1.%2"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="620"/></w:tabs><w:ind w:left="620" w:hanging="620"/></w:pPr></w:lvl></w:abstractNum>'
foreach ($id in 1..3) { $numbering += '<w:num w:numId="' + $id + '"><w:abstractNumId w:val="' + $id + '"/></w:num>' }
$parts['word/numbering.xml'] = $numbering + '</w:numbering>'
$parts['word/settings.xml'] = '<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:zoom w:percent="100"/><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:updateFields w:val="true"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
$parts['word/header1.xml'] = '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + (Paragraph-Xml 'PC49  |  Bàn giao cải thiện UI/UX  |  05/09/2026' 'Header') + '</w:hdr>'
$parts['word/footer1.xml'] = '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr>' + (Run-Xml 'PC49 · v1.0     |     Trang ') + '<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>'
$parts['word/_rels/document.xml.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>'
$parts['_rels/.rels'] = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdDocument" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rIdCore" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rIdApp" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'
$parts['docProps/core.xml'] = '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>PC49 - Đặc tả cải thiện giao diện và độ tin cậy thao tác</dc:title><dc:subject>Bàn giao kỹ thuật UI/UX, transaction và nghiệm thu</dc:subject><dc:creator>PC49</dc:creator><dc:language>vi-VN</dc:language><cp:keywords>PC49, UI, UX, technical handoff</cp:keywords><dc:description>19 phần, backlog 14 ticket, 52 ca kiểm thử. Đề xuất triển khai theo baseline ngày 05/09/2026.</dc:description></cp:coreProperties>'
$parts['docProps/app.xml'] = '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PC49 Technical Handoff Builder</Application></Properties>'
$contentTypes = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
$types = @{
  'word/document.xml' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'
  'word/styles.xml' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'
  'word/numbering.xml' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
  'word/settings.xml' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'
  'word/header1.xml' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
  'word/footer1.xml' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'
  'docProps/core.xml' = 'application/vnd.openxmlformats-package.core-properties+xml'
  'docProps/app.xml' = 'application/vnd.openxmlformats-officedocument.extended-properties+xml'
}
foreach ($key in $types.Keys) { $contentTypes += '<Override PartName="/' + $key + '" ContentType="' + $types[$key] + '"/>' }
$parts['[Content_Types].xml'] = $contentTypes + '</Types>'

# Structural QA before writing: parse every XML part and verify exact geometry.
foreach ($key in $parts.Keys) { [xml]$parsedPart = $parts[$key] }
[xml]$document = $parts['word/document.xml']
$ns = New-Object Xml.XmlNamespaceManager($document.NameTable)
$ns.AddNamespace('w', 'http://schemas.openxmlformats.org/wordprocessingml/2006/main')
foreach ($table in $document.SelectNodes('//w:tbl', $ns)) {
  $grid = @($table.SelectNodes('w:tblGrid/w:gridCol', $ns) | ForEach-Object { [int]$_.GetAttribute('w', $ns.LookupNamespace('w')) })
  if (($grid | Measure-Object -Sum).Sum -ne 9360) { throw 'Table grid width mismatch' }
  foreach ($row in $table.SelectNodes('w:tr', $ns)) {
    $cellWidths = @($row.SelectNodes('w:tc/w:tcPr/w:tcW', $ns) | ForEach-Object { [int]$_.GetAttribute('w', $ns.LookupNamespace('w')) })
    if (($cellWidths -join ',') -ne ($grid -join ',')) { throw 'Cell width mismatch' }
  }
}
$h1 = $document.SelectNodes('//w:p[w:pPr/w:pStyle[@w:val="Heading1"]]', $ns).Count
$anchors = @($document.SelectNodes('//w:bookmarkStart', $ns) | ForEach-Object { $_.GetAttribute('name', $ns.LookupNamespace('w')) })
foreach ($link in $document.SelectNodes('//w:hyperlink', $ns)) {
  if ($link.GetAttribute('anchor', $ns.LookupNamespace('w')) -notin $anchors) { throw 'Broken TOC anchor' }
}
$allText = ($document.SelectNodes('//w:t', $ns) | ForEach-Object { $_.InnerText }) -join "`n"
if ($allText.Contains([char]0xfffd)) { throw 'Unicode replacement character found' }
foreach ($id in 1..22) {
  if ($allText -notmatch ('TX-' + $id.ToString('00'))) { throw "Missing TX test $id" }
}
foreach ($id in 1..30) {
  if ($allText -notmatch ('UI-' + $id.ToString('00'))) { throw "Missing UI test $id" }
}
if ($h1 -ne 19) { throw "Expected 19 top-level sections; got $h1" }

[void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath))
$fileStream = [IO.File]::Open($outputPath, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite)
$zip = New-Object IO.Compression.ZipArchive($fileStream, [IO.Compression.ZipArchiveMode]::Create, $false)
try {
  foreach ($key in $parts.Keys) {
    $entry = $zip.CreateEntry($key, [IO.Compression.CompressionLevel]::Optimal)
    $stream = $entry.Open()
    $bytes = $utf8.GetBytes($parts[$key])
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Dispose()
  }
} finally {
  $zip.Dispose()
  $fileStream.Dispose()
}

[ordered]@{
  output = $outputPath
  bytes = (Get-Item -LiteralPath $outputPath).Length
  sourceCharacters = ([IO.File]::ReadAllText($sourcePath, [Text.Encoding]::UTF8)).Length
  sections = $h1
  headings = $headingCount
  tables = $tableCount
  bullets = $bulletCount
  paragraphs = $paragraphCount
  testCases = 52
  structuralQa = 'PASS: XML, table geometry, TOC anchors, required test IDs, Unicode'
  visualQa = 'NOT RUN: LibreOffice unavailable in current environment'
} | ConvertTo-Json
