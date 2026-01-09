# 文件比对的设计方案
用户需要上传两份文件，一份为原件，一份为修改件。

工具需要将文件解析并将两份文件的差异展示出来以方便用户了解有哪些区别。


## 转换
- 用户上传的文件一般为pdf或者docx。

- 大部分文档识别或OCR解析软件都只支持pdf或者img。

- 因此为了满足标准化，需要将用户上传的文件转换为pdf或者img。

目前调研发现，有以下几种方案：
### MinerU
详细信息见官网：https://opendatalab.github.io/MinerU/zh/reference/output_files/

本身就支持pdf/docx/img等格式。转换后会生成一个zip文件，里面包含了详细的解析后数据如：

模型输出(使用原始输出):

model.json
调试和验证(使用可视化文件):

layout.pdf
spans.pdf
内容提取(使用简化文件):

*.md
content_list.json
二次开发(使用结构化文件):

middle.json

### PaddleOCR
仅支持pdf/img格式。

### gotenberg
支持将docx转换为pdf。详细信息见官网：https://gotenberg.dev/docs/getting-started/introduction

## 比对

在前面的转换逻辑处理完之后，理论上标准的输出应该会包含，一个pdf原件（或转换后的pdf）和一个json数据。

比对主要分为两个部分
1. json数据包含了详细的坐标和具体的文本，因此是比较差异的核心，需要确保差异比对时能够详细将两份文件的差异全部列举出来。

2. pdf原件（或转换后的pdf）是展示差异的载体，因为用户需要直观的看到自己的文件在什么地方存在差异性，所以需要结合json对比的结果来将结果回显到pdf上。