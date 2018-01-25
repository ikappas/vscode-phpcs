# vscode-phpcs

This linter plugin for [Visual Studio Code](https://code.visualstudio.com/) provides an interface to [phpcs](http://pear.php.net/package/PHP_CodeSniffer/). It will be used with files that have the “PHP” language mode.

## Installation

Visual Studio Code must be installed in order to use this plugin. If Visual Studio Code is not installed, please follow the instructions [here](https://code.visualstudio.com/Docs/editor/setup).

## Linter Installation

Before using this plugin, you must ensure that `phpcs` is installed on your system. The installation can be performed system-wide using [pear](http://pear.php.net/) or system-wide / project-wide using [composer](https://getcomposer.org/).

Once phpcs is installed, you can proceed to install the vscode-phpcs plugin if it is not yet installed.

> **NOTE:** This plugin will detect whether your project has been set up to use phpcs via composer and use the project specific `phpcs` over the system-wide installation of `phpcs` automatically. This feature requires that both composer.json and composer.lock file exist in your workspace root or the `phpcs.composerJsonPath` in order to check for the composer dependency. If you wish to bypass this feature you can set the `phpcs.executablePath` configuration setting.

> **WARNING:** PHPCS will not give you error "error: "phpcs: Unexpected token S in JSON at position 0" if you are using php <7.1.13 OR 7.2.1. This bug is fixed by php so just upgrade your php version to >=7.1.13 OR >=7.2.1.

### System-wide Installation

#### Using PEAR

The `phpcs` linter can be installed in your system using the PHP Extension and Application Repository (PEAR).

1. Install [pear](http://pear.php.net).
1. Install `phpcs` by typing the following in a terminal:

    ```bash
    pear install PHP_CodeSniffer
    ```

#### Using Composer

The `phpcs` linter can be installed globally using the Composer Dependency Manager for PHP.

1. Install [composer](https://getcomposer.org/doc/00-intro.md).
1. Require `phpcs` package by typing the following in a terminal:

    ```bash
    composer global require squizlabs/php_codesniffer
    ```

### Project-wide Installation

The `phpcs` linter can be installed in your project using the Composer Dependency Manager for PHP.

1. Install [composer](https://getcomposer.org/doc/00-intro.md).
1. Require `phpcs` package by typing the following at the root of your project in a terminal:

    ```bash
    composer require --dev squizlabs/php_codesniffer
    ```

### Plugin Installation

1. Open Visual Studio Code.
1. Press `Ctrl+P` on Windows or `Cmd+P` on Mac to open the Quick Open dialog.
1. Type ext install phpcs to find the extension.
1. Press Enter or click the cloud icon to install it.
1. Restart Visual Studio Code when prompted.

## Basic Configuration

There are various options that can be configured by making changes to your user or workspace preferences.

### **phpcs.enable**

[ Optional | **Default**: `true` ]

This setting controls whether `phpcs` linting is enabled.

### **phpcs.executablePath**

[ Optional | **Default**: `null` ]

This setting controls the executable path for the `phpcs`. You may specify the absolute path or workspace relative path to the `phpcs` executable.
If omitted, the plugin will try to locate the path parsing your composer configuration or the global path.

### **phpcs.standard**

[ Optional | **Default:** `null` ]

This setting controls the coding standard used by `phpcs`. You may specify the name, absolute path or workspace relative path of the coding standard to use.

> **NOTE:** While using composer dependency manager over global installation make sure you use the phpcs commands under your project scope !

The following values are applicable:

1. This setting can be set to `null`, which is the default behavior and uses the `default_standard` when set in the `phpcs` configuration or fallback to the `Pear` coding standard.

    ```json
    {
        "phpcs.standard": null
    }
    ```

    You may set the `default_standard` used by phpcs using the following command:

    ```bash
    phpcs --config-set default_standard <value>
    ```

    or when using composer dependency manager from the root of your project issue the following command:

    ```bash
    ./vendor/bin/phpcs --config-set default_standard <value>
    ```

1. The setting can be set to the name of a built-in coding standard ( ie. `MySource`, `PEAR`, `PHPCS`, `PSR1`, `PSR2`, `Squiz`, `Zend` ) and you are good to go.

    ```json
    {
        "phpcs.standard": "PSR2"
    }
    ```

1. The setting can me set to the name of a custom coding standard ( ie. `WordPress`, `Drupal`, etc. ). In this case you must ensure that the specified coding standard is installed and accessible by `phpcs`.

    ```json
    {
        "phpcs.standard": "WordPress"
    }
    ```

    After you install the custom coding standard, you can make it available to phpcs by issuing the following command:

    ```bash
    phpcs --config-set installed_paths <path/to/custom/coding/standard>
    ```

    or when using composer dependency manager from the root of your project issue the following command:

    ```bash
    ./vendor/bin/phpcs --config-set installed_paths <path/to/custom/coding/standard>
    ```

1. The setting can be set to the absolute path to a custom coding standard:

    ```json
    {
        "phpcs.standard": "/path/to/coding/standard"
    }
    ```

    or you can use the path to a custom ruleset:

    ```json
    {
        "phpcs.standard": "/path/to/project/phpcs.xml"
    }
    ```

1. The setting can be set to your workspace relative path to a custom coding standard:

    ```json
    {
        "phpcs.standard": "./vendor/path/to/coding/standard"
    }
    ```

    or you can use the path to your project's custom ruleset:

    ```json
    {
        "phpcs.standard": "./phpcs.xml"
    }
    ```

### **phpcs.ignorePatterns**

[ Optional | **Type:** `array` | **Default:** `[]` ]

An array of glob patterns to skip files and folders that match when linting your documents.

```json
{
    "phpcs.ignorePatterns": [
        "*/ignored-file.php",
        "*/ignored-dir/*"
    ]
}
```

### **phpcs.errorSeverity**

[ Optional | **Type:** `number` | **Default:** `5` ]

The minimum severity an error must have to be displayed. You may specify an integer value.

### **phpcs.warningSeverity**

[ Optional | **Type:** `number` | **Default:** `5` ]

The minimum severity a warning must have to be displayed. You may specify an integer value.

### **phpcs.showWarnings**

[ Optional | **Default**: `true` ]

Control whether warnings are displayed.

### **phpcs.showSources**

[ Optional | **Default**: `false` ]

Show sniff source codes in diagnostic messages.

### **phpcs.trace.server**

[ Optional | **Default**: `off` ]

This setting controls whether the trace server is activated. Possible values you can use is `off`, `messages` or `verbose`.

## Advanced Configuration

### **phpcs.composerJsonPath**

[ Optional | **Default**: `composer.json` ]

This setting allows you to override the path to your composer.json file when it does not reside at the workspace root. You may specify the absolute path or workspace relative path to the `composer.json` file.

## Acknowledgements

The extension architecture is based off of the [Language Server Node Example](https://github.com/Microsoft/vscode-languageserver-node-example).

## Contributing and Licensing

The project is hosted on [GitHub](https://github.com/ikappas/vscode-phpcs) where you can [report issues](https://github.com/ikappas/vscode-phpcs/issues), fork
the project and submit pull requests.

The project is available under [MIT license](https://github.com/ikappas/vscode-phpcs/blob/master/LICENSE.md), which allows modification and
redistribution for both commercial and non-commercial purposes.
