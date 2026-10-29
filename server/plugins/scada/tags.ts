// 点位目录：组态画布可绑定的通道变量。
//
// 现在是一份静态表（演示工程）；接真实采集时把 `scadaTags()` 换成查设备表即可，
// 服务层与画布都只认 `ScadaTagOption[]`，不需要改。
import type { ScadaTagOption } from '../../../src/shared/scada/types.ts'

export function scadaTags(): ScadaTagOption[] {
  return [
    {
      tagId: 101, name: '原水箱液位', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / AI12 / 原水箱液位',
      assetNodeId: 1, assetNodeName: 'AI12 模拟量输入', channelType: 'AI', channelNo: 1, physicalName: 'AI1',
      accessMode: 'R', dataTypeName: 'REAL', registerTypeName: '输入寄存器', registerAddress: 0, enabled: true,
      currentValueText: '72.5', qualityCode: 'GOOD', qualityText: '正常',
    },
    {
      tagId: 102, name: '出水压力', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / AI12 / 出水压力',
      assetNodeId: 1, assetNodeName: 'AI12 模拟量输入', channelType: 'AI', channelNo: 2, physicalName: 'AI2',
      accessMode: 'R', dataTypeName: 'REAL', registerTypeName: '输入寄存器', registerAddress: 1, enabled: true,
      currentValueText: '0.42', qualityCode: 'GOOD', qualityText: '正常',
    },
    {
      tagId: 103, name: '1# 泵运行', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / DI24 / 1# 泵运行',
      assetNodeId: 2, assetNodeName: 'DI24 数字量输入', channelType: 'DI', channelNo: 1, physicalName: 'DI1',
      accessMode: 'R', dataTypeName: 'BOOL', registerTypeName: '离散输入', registerAddress: 0, enabled: true,
      currentValueText: '1', qualityCode: 'GOOD', qualityText: '正常',
    },
    {
      tagId: 104, name: '1# 泵启停', path: '演示工程 / 水处理 / 机箱 A / 网关 1 / DO24 / 1# 泵启停',
      assetNodeId: 3, assetNodeName: 'DO24 数字量输出', channelType: 'DO', channelNo: 1, physicalName: 'DO1',
      accessMode: 'RW', dataTypeName: 'BOOL', registerTypeName: '保持寄存器', registerAddress: 0, enabled: true,
      currentValueText: '1', qualityCode: 'GOOD', qualityText: '正常',
    },
  ]
}
