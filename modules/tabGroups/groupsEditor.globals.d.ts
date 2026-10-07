declare namespace Functions {
	namespace TabGroups {
		namespace GroupsEditor {
			type createGroupsEditor = ( value: unknown ) => Types.TabGroups.GroupsEditorElement;
			namespace createGroupsEditor {
				type readRaw = () => Record<string, { title: string; color: string; collapsed: boolean }>;
				type refresh = () => void;
			}
			type createCollapsedCheckbox = ( checked: boolean, ariaLabel: string ) => {
				label: HTMLLabelElement;
				input: HTMLInputElement;
			};
		}
	}
}
