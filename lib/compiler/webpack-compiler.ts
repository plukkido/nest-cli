import { existsSync } from 'fs';
import { dirname, join, normalize, relative } from 'path';
import webpack = require('webpack');

import { Configuration } from '../configuration';
import { INFO_PREFIX, ERROR_PREFIX } from '../ui';
import { AssetsManager } from './assets-manager';
import { webpackDefaultsFactory } from './defaults/webpack-defaults';
import { getValueOrDefault } from './helpers/get-value-or-default';
import { PluginsLoader } from './plugins-loader';

type WebpackSingleConfigFactory = (
  config: webpack.Configuration,
) => webpack.Configuration;
type WebpackSingleConfigOrFactory =
  | WebpackSingleConfigFactory
  | webpack.Configuration;
type WebpackMultiConfigFactory = (
  config: webpack.Configuration,
) => webpack.Configuration[];
type WebpackMultiConfigOrFactory =
  | WebpackMultiConfigFactory
  | webpack.Configuration[];

export class WebpackCompiler {
  constructor(private readonly pluginsLoader: PluginsLoader) {}

  private runSinge(
    webpackConfigFactoryOrConfig: WebpackSingleConfigOrFactory,
    defaultOptions: webpack.Configuration,
    watchMode = false,
    assetsManager: AssetsManager,
    onSuccess?: () => void,
  ) {
    const projectWebpackOptions =
      typeof webpackConfigFactoryOrConfig !== 'function'
        ? webpackConfigFactoryOrConfig
        : webpackConfigFactoryOrConfig(defaultOptions);
    const webpackConfiguration = {
      ...defaultOptions,
      ...projectWebpackOptions,
    };
    const compiler = webpack(webpackConfiguration);

    const afterCallback = (err: Error, stats: any) => {
      const statsOutput = stats.toString({
        chunks: false,
        colors: true,
        modules: false,
        assets: false,
        warningsFilter: /^(?!CriticalDependenciesWarning$)/,
      });
      if (!err && !stats.hasErrors()) {
        if (!onSuccess) {
          assetsManager.closeWatchers();
        } else {
          onSuccess();
        }
      } else if (!watchMode && !webpackConfiguration.watch) {
        console.log(statsOutput);
        return process.exit(1);
      }
      console.log(statsOutput);
    };

    if (watchMode || webpackConfiguration.watch) {
      compiler.hooks.watchRun.tapAsync('Rebuild info', (params, callback) => {
        console.log(`\n${INFO_PREFIX} Webpack is building your sources...\n`);
        callback();
      });
      compiler.watch(webpackConfiguration.watchOptions! || {}, afterCallback);
    } else {
      compiler.run(afterCallback);
    }
  }

  private runMulti(
    webpackConfigFactoriesOrConfigs: WebpackMultiConfigOrFactory,
    defaultOptions: webpack.Configuration,
    watchMode = false,
    assetsManager: AssetsManager,
    onSuccess?: () => void,
  ) {
    const projectsWebpackOptions =
      typeof webpackConfigFactoriesOrConfigs !== 'function'
        ? webpackConfigFactoriesOrConfigs
        : webpackConfigFactoriesOrConfigs(defaultOptions);
    const webpackConfigurations = projectsWebpackOptions.map(
      (options: any) => ({
        ...defaultOptions,
        ...options,
      }),
    );
    const compiler = webpack(webpackConfigurations);

    const afterCallback = (err: Error, stats: any) => {
      const statsOutput = stats.toString({
        chunks: false,
        colors: true,
        modules: false,
        assets: false,
        warningsFilter: /^(?!CriticalDependenciesWarning$)/,
      });
      if (!err && !stats.hasErrors()) {
        if (!onSuccess) {
          assetsManager.closeWatchers();
        } else {
          onSuccess();
        }
      } else if (
        !watchMode &&
        !webpackConfigurations.every(
          (_: { hasOwnProperty: (arg0: string) => any }) =>
            _.hasOwnProperty('watch'),
        )
      ) {
        console.log(statsOutput);
        return process.exit(1);
      }
      console.log(statsOutput);
    };

    const mergeWatchOptions = (
      watchOptions: (webpack.MultiCompiler.WatchOptions | undefined)[],
    ) => {
      const validWatchOptions = watchOptions.filter((_) => _);
      if (validWatchOptions.length > 1) {
        const [firstOptions, ...restOfTheOptions] = validWatchOptions;
        const mergedWatchOptions = restOfTheOptions.reduce(
          (common, current) => {
            if (common!.aggregateTimeout !== current!.aggregateTimeout) {
              throw new Error(
                `\n${ERROR_PREFIX} Your multi configuration for watchOptions is conflicting: ` +
                  'aggregateTimout values differ between configurations\n',
              );
            }

            if (common!.poll !== current!.poll) {
              throw new Error(
                `Your multi configuration for watchOptions is conflicting: ` +
                  'poll values differ between configurations\n',
              );
            }

            const flatten = (arr: any[]) =>
              arr.reduce(
                (acc: any, curr: any) =>
                  Array.isArray(curr) ? [...acc, ...curr] : [...acc, curr],
                [],
              );
            const ignored = flatten([common!.ignored, current!.ignored]).filter(
              (_: any) => _,
            );

            return {
              aggregateTimeout: current!.aggregateTimeout,
              ignored: ignored,
              poll: current!.poll,
            };
          },
          firstOptions,
        );

        return mergedWatchOptions!;
      }

      const [ret] = watchOptions;
      return ret || {};
    };

    if (
      watchMode ||
      webpackConfigurations.some(
        (_: { hasOwnProperty: (arg0: string) => any }) =>
          _.hasOwnProperty('watch'),
      )
    ) {
      compiler.hooks.watchRun.tapAsync('Rebuild info', (params, callback) => {
        console.log(`\n${INFO_PREFIX} Webpack is building your sources...\n`);
        callback();
      });
      try {
        const mergedWatchOptions = mergeWatchOptions(
          webpackConfigurations.map(
            (_: { watchOptions: any }) => _.watchOptions,
          ),
        );
        compiler.watch(mergedWatchOptions, afterCallback);
      } catch (error) {
        console.log(`\n${ERROR_PREFIX} ${error.message}`);
      }
    } else {
      compiler.run(afterCallback);
    }
  }

  public isMultiConfig(
    config: WebpackSingleConfigOrFactory | WebpackMultiConfigOrFactory,
  ): config is (config: webpack.Configuration) => webpack.Configuration[] {
    return Array.isArray(config);
  }

  public isSingleConfig(
    config: WebpackSingleConfigOrFactory | WebpackMultiConfigOrFactory,
  ): config is (config: webpack.Configuration) => webpack.Configuration {
    return !this.isMultiConfig(config);
  }

  public getDefaultOptions(
    configuration: Required<Configuration>,
    tsConfigPath: string,
    appName: string,
    isDebugEnabled = false,
  ) {
    const cwd = process.cwd();
    const configPath = join(cwd, tsConfigPath!);
    if (!existsSync(configPath)) {
      throw new Error(
        `Could not find TypeScript configuration file "${tsConfigPath!}".`,
      );
    }

    const pluginsConfig = getValueOrDefault(
      configuration,
      'compilerOptions.plugins',
      appName,
    );
    const plugins = this.pluginsLoader.load(pluginsConfig);
    const relativeRootPath = dirname(relative(cwd, configPath));
    const sourceRoot = getValueOrDefault<string>(
      configuration,
      'sourceRoot',
      appName,
    );
    const pathToSource =
      normalize(sourceRoot).indexOf(normalize(relativeRootPath)) >= 0
        ? join(cwd, sourceRoot)
        : join(cwd, relativeRootPath, sourceRoot);

    const entryFile = getValueOrDefault<string>(
      configuration,
      'entryFile',
      appName,
    );
    const entryFileRoot =
      getValueOrDefault<string>(configuration, 'root', appName) || '';
    const defaultOptions = webpackDefaultsFactory(
      pathToSource,
      entryFileRoot,
      entryFile,
      isDebugEnabled,
      tsConfigPath,
      plugins,
    );

    return defaultOptions;
  }

  public run(
    configuration: Required<Configuration>,
    webpackConfigFactoryOrConfig:
      | WebpackSingleConfigOrFactory
      | WebpackMultiConfigOrFactory,
    tsConfigPath: string,
    appName: string,
    isDebugEnabled = false,
    watchMode = false,
    assetsManager: AssetsManager,
    onSuccess?: () => void,
  ) {
    const defaultOptions = this.getDefaultOptions(
      configuration,
      tsConfigPath,
      appName,
      isDebugEnabled,
    );

    if (this.isSingleConfig(webpackConfigFactoryOrConfig)) {
      return this.runSinge(
        webpackConfigFactoryOrConfig,
        defaultOptions,
        watchMode,
        assetsManager,
        onSuccess,
      );
    }

    if (this.isMultiConfig(webpackConfigFactoryOrConfig)) {
      return this.runMulti(
        webpackConfigFactoryOrConfig,
        defaultOptions,
        watchMode,
        assetsManager,
        onSuccess,
      );
    }

    console.log(
      `${ERROR_PREFIX} Webpack run configuration is malformed. It's neither recognized as single-` +
        ' nor as a multi-config setup. Are you sure your config is an object or an array, or your config' +
        ' function does not return an object or an array?',
    );
  }
}
