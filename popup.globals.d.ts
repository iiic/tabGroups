declare namespace Classes {
	interface PopupController extends BaseController {
		outputEl: HTMLElement;
		_paths: string[];
		loadAndRegisterModules(): Promise<void>;
		initModules(): Promise<void>;
		bootstrap(): Promise<void>;
	}
}
