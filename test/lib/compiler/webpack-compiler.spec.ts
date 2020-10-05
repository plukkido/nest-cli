import * as path from 'path';
import { WebpackCompiler } from '../../../lib/compiler/webpack-compiler';
import { PluginsLoader } from '../../../lib/compiler/plugins-loader';
import { AssetsManager } from '../../../lib/compiler/assets-manager';
import { defaultConfiguration } from '../../../lib/configuration/defaults';

const webpackRun = jest.fn();
jest.mock('webpack', () => {
  const webpack = (config: any) => {
    return {
      config,
      run: webpackRun,
    };
  };
  webpack.IgnorePlugin = class {};

  return webpack;
});

describe('Can build configuration', () => {
  const pluginsLoader = new PluginsLoader();
  const assetsManager = new AssetsManager();
  const compiler = new WebpackCompiler(pluginsLoader);
  const defaultOptions = compiler.getDefaultOptions(
    defaultConfiguration,
    'test/lib/compiler/tsconfig.json',
    'nestjs-cli',
    true,
  );

  afterEach(() => {
    webpackRun.mockReset();
  });
  it('should recognize single-config setups', () => {
    compiler.run(
      defaultConfiguration,
      {},
      'test/lib/compiler/tsconfig.json',
      'nestjs-cli',
      true,
      false,
      assetsManager,
      () => {},
    );

    const receivedConfig = JSON.stringify(webpackRun.mock.instances[0].config);
    const expectedConfig = JSON.stringify(defaultOptions);

    expect(receivedConfig).toBe(expectedConfig);
  });
  it('should recognize multi-config setups', () => {
    compiler.run(
      defaultConfiguration,
      [{}, {}],
      'test/lib/compiler/tsconfig.json',
      'nestjs-cli',
      true,
      false,
      assetsManager,
      () => {},
    );

    const receivedConfig = JSON.stringify(webpackRun.mock.instances[0].config);
    const expectedConfig = JSON.stringify([defaultOptions, defaultOptions]);

    expect(receivedConfig).toBe(expectedConfig);
  });
  //TODO: it('should signal if watchOptions are inconsistent', () => {});
});
