# 机位来源与版本

本文件记录用户于 2026-09-26 选定的 8 图 36 个固定机位。坐标不做跨版本偏移或缩放；按钮名为中文简写。

- D01、D04、D05、D07；M02、M03、M05；I01、I02、I03、I06、I08；N01–N05；AC01、AC03、AC06、AC07；AN01–AN06；O01、O02、O07、O08：Live on Three 的 CS2 配置（2023）。原始编号对应 `game/csgo/cfg/OBmemo.txt` 中的机位名称。
  https://github.com/lo3jp/cs2-observer-configs/blob/main/game/csgo/cfg/OBmemo.txt
- D21：CS Demo Manager 的 CS2 Dust2 `Mid Catwalk2`，2025-11-18 摄像机功能提交中的数据。
  https://github.com/akiver/cs-demo-manager/blob/main/src/node/database/cameras/insert-default-cameras.ts
- C01、C04、C06、C07：CS:GO Cache 配置的 `a_site_quad_goto`、`mid_t_goto`、`mid_goto`、`b_site_halls_corner_goto`。作为用户选择的原坐标保留，未在当前 CS2 中实机校准。
  https://github.com/kynarilaarnio/csgo-observer-config/blob/master/pos_cache.cfg

坐标格式：世界 X/Y/Z、俯仰角 pitch、偏航角 yaw。固定机位只发送原生 `spec_autodirector 0; spec_mode 6; spec_goto ...`，不使用 HLAE 或旧版 `spec_lerpto`。同图的静态按钮无需统一换算雷达缩放；地图图片坐标不是相机世界坐标。

## MIT notices

Copyright (c) 2023 Live on Three

Copyright (c) 2016 baabelfish

Copyright (c) 2014-present AkiVer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
