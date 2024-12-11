// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ConfigurationChangeEvent, ConfigurationScope, WorkspaceConfiguration, WorkspaceFolder } from 'vscode';
import { getInterpreterDetails } from './python';
import { getConfiguration, getWorkspaceFolders } from './vscodeapi';

interface AutoImport {
    variable: string;
    import: string;
}

export interface ISettings {
    cwd: string;
    workspace: string;
    interpreter: string[];
    showNotifications: string;
    autoImports: AutoImport[];
    onTypeTriggerCharacters: string;
    // Whenever adding a new variable, be sure to add a new value to the string array in checkIfConfigurationChanged
}

export function getExtensionSettings(namespace: string, includeInterpreter?: boolean): Promise<ISettings[]> {
    return Promise.all(getWorkspaceFolders().map((w) => getWorkspaceSettings(namespace, w, includeInterpreter)));
}

function resolveVariables(value: string[], workspace?: WorkspaceFolder): string[] {
    const substitutions = new Map<string, string>();
    const home = process.env.HOME || process.env.USERPROFILE;
    if (home) {
        substitutions.set('${userHome}', home);
    }
    if (workspace) {
        substitutions.set('${workspaceFolder}', workspace.uri.fsPath);
    }
    substitutions.set('${cwd}', process.cwd());
    getWorkspaceFolders().forEach((w) => {
        substitutions.set('${workspaceFolder:' + w.name + '}', w.uri.fsPath);
    });

    return value.map((s) => {
        for (const [key, value] of substitutions) {
            s = s.replace(key, value);
        }
        return s;
    });
}

export function getInterpreterFromSetting(namespace: string, scope?: ConfigurationScope) {
    const config = getConfiguration(namespace, scope);
    return config.get<string[]>('interpreter');
}

export async function getWorkspaceSettings(
    namespace: string,
    workspace: WorkspaceFolder,
    includeInterpreter?: boolean,
): Promise<ISettings> {
    const config = getConfiguration(namespace, workspace.uri);

    let interpreter: string[] = [];
    if (includeInterpreter) {
        interpreter = getInterpreterFromSetting(namespace, workspace) ?? [];
        if (interpreter.length === 0) {
            interpreter = (await getInterpreterDetails(workspace.uri)).path ?? [];
        }
    }

    return {
        cwd: workspace.uri.fsPath,
        workspace: workspace.uri.toString(),
        interpreter: resolveVariables(interpreter, workspace),
        showNotifications: config.get<string>(`showNotifications`) ?? 'off',
        // Actual defaults are set in lsp_server code
        autoImports: config.get<AutoImport[]>(`autoImports`) ?? [],
        onTypeTriggerCharacters: config.get<string>('onTypeTriggerCharacters') ?? '',
    };
}

function getGlobalValue<T>(config: WorkspaceConfiguration, key: string, defaultValue: T): T {
    const inspect = config.inspect<T>(key);
    return inspect?.globalValue ?? inspect?.defaultValue ?? defaultValue;
}

export async function getGlobalSettings(namespace: string, includeInterpreter?: boolean): Promise<ISettings> {
    const config = getConfiguration(namespace);

    let interpreter: string[] = [];
    if (includeInterpreter) {
        interpreter = getGlobalValue<string[]>(config, 'interpreter', []);
        if (interpreter === undefined || interpreter.length === 0) {
            interpreter = (await getInterpreterDetails()).path ?? [];
        }
    }

    return {
        cwd: process.cwd(),
        workspace: process.cwd(),
        interpreter: interpreter,
        showNotifications: getGlobalValue<string>(config, 'showNotifications', 'off'),
        // Actual defaults are set in lsp_server code
        autoImports: getGlobalValue<AutoImport[]>(config, 'autoImports', []),
        onTypeTriggerCharacters: getGlobalValue<string>(config, 'onTypeTriggerCharacters', ''),
    };
}

export function checkIfConfigurationChanged(e: ConfigurationChangeEvent, namespace: string): boolean {
    const settings = [
        `${namespace}.interpreter`,
        `${namespace}.showNotifications`,
        `${namespace}.autoImports`,
        `${namespace}.onTypeTriggerCharacters`,
    ];
    const changed = settings.map((s) => e.affectsConfiguration(s));
    return changed.includes(true);
}
