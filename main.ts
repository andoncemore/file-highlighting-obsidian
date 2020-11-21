import { access } from 'fs';
import { App, Plugin, PluginSettingTab, Setting, TFile, ButtonComponent, ExtraButtonComponent, parseLinktext} from 'obsidian';

export default class FileHighlightingPlugin extends Plugin {

	settings: FileColoringSettings;
	allFiles: {[title:string] : string}
	private observer: MutationObserver;
	private popoverObserver: MutationObserver;
	private editObserver: MutationObserver;

	async onload() {
		
		console.log('loading plugin');
		
		// Start by initializing the settings
		this.allFiles = {};
		this.settings = await this.loadData() || new FileColoringSettings();
		this.addSettingTab(new HighlightSettingsTab(this.app, this));

		this.registerEvent(this.app.on('codemirror', (cm: CodeMirror.Editor) => {
			console.log('codemirror', cm);
		}));

		//On the first load of the system, get all the markdown leaves and put edit and content observers on them
		this.app.workspace.on("layout-ready", () =>{
			this.parseAllFiles();
			let openLeaves = this.app.workspace.getLeavesOfType("markdown");
			openLeaves.forEach((leaf) =>{
				// console.log(leaf.getViewState());
				this.editObserver.observe(leaf.view.containerEl, {attributes:true, attributeFilter:['data-mode']});
				this.observer.observe(leaf.view.containerEl.find(".markdown-preview-sizer"), {childList:true});
			});
		})

		// The content observer that watches leaves as content is progressively added and removed
		this.observer = new MutationObserver((mutations) =>{
			mutations.forEach((mutation) =>{
				mutation.addedNodes.forEach((elm) =>{
					if(elm.nodeType == 1){
						this.setTagColors(<Element>elm);
					}
				});
			})
		});

		// The popover observer watches for popovers, and then adds the content observer to them
		this.popoverObserver = new MutationObserver((mutations) =>{
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((elm) => {
					if((<Element>elm).className == "popover hover-popover is-loaded"){
						this.observer.observe((<Element>elm).find(".markdown-preview-sizer"), {childList:true});
					}
				})
			})
		});

		// Edit observer is watching to see when you switch between edit and preview mode, checking to see if you changed tags, and then updating all open leaves to reflect that change. 
		this.editObserver = new MutationObserver((mutations) => {
			if((<Element>mutations[0].target).getAttr("data-mode") == "preview"){
				let path = (<Element>mutations[0].target).getAttr("name");
				let f = <TFile>this.app.vault.getAbstractFileByPath(path);
				setTimeout(() =>{
					let newTag = this.parseTag(f);
					if(newTag != this.allFiles[f.basename]){
						this.allFiles[f.basename] = newTag;
						this.resetColors();
					}
				},50);	
			}
		});

		this.popoverObserver.observe(document.querySelector("body"), {childList:true});
		// Whenever files first open, or when you first make a file "active"
		this.app.workspace.on("file-open", (file) => {
			if(file != null){
				// console.log("File Open ", file);

				// First, store the path of the file in the DOM via attribute so you can access later in the edit observer
				let activePanel = this.app.workspace.activeLeaf;
				activePanel.view.containerEl.setAttr("name",file.path)
			
				//Then if you are opening a page for the first time (not just making it active), add content and edit observers
				if(activePanel.view.containerEl.find(".markdown-preview-sizer").children.length < 1){
					this.editObserver.observe(activePanel.view.containerEl, {attributes:true, attributeFilter:['data-mode']});
					this.observer.observe(activePanel.view.containerEl.find(".markdown-preview-sizer"), {childList:true})
				}
			}
			
		});

		// Handle all the new file, or rename, or delete file cases

		this.app.vault.on("create", (file) =>{
			if(!this.allFiles.hasOwnProperty((<TFile>file).basename)){
				// console.log("created file", file);
				this.allFiles[(<TFile>file).basename] = "";
			}
		});

		this.app.vault.on("rename",(file,oldpath) =>{
			// console.log("renamed file", file, oldpath);
			this.allFiles[(<TFile>file).basename] = this.allFiles[oldpath.replace(/\.[^/.]+$/, "")];
			delete this.allFiles[oldpath.replace(/\.[^/.]+$/, "")];
		});

		this.app.vault.on("delete",(file) =>{
			// console.log("delete", file);
			delete this.allFiles[(<TFile>file).basename];
		});

	}


	// Loop through all files, determining their main tag.
	parseAllFiles(){
		this.allFiles = this.app.vault.getMarkdownFiles().map((f) => ({basename: f.basename, tag: this.parseTag(f)}))
			.reduce((acc,val) => ({...acc, [val.basename]: val.tag}),{});

		console.log(this.allFiles);
	}

	//Go through the app and update colors.
	resetColors(){
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) =>{
			this.setTagColors(leaf.view.containerEl);
		});
	}

	// For an individual file, return the main tag
	parseTag(file: TFile){
		let allTags = this.app.metadataCache.getFileCache(file).tags;
		if(allTags){
			allTags.sort((a,b) =>{
				if(isFinite(this.settings.tagSort[a.tag]-this.settings.tagSort[b.tag])){
					return this.settings.tagSort[a.tag] - this.settings.tagSort[b.tag]
				}
				else{
					return isFinite(this.settings.tagSort[a.tag]) ? -1 : 1;
				}
			})
			let oneTag = allTags.find((e) => e.tag in this.settings.tagSort);
			if(oneTag){
				return oneTag.tag;
			}
			else{
				return "";
			}
		}
		else{
			return "";
		}
	}

	// Given a parent element, update all the links
	setTagColors(elm: Element) {
		interface linktext{
			path: string;
			subpath: string;
		}
		elm.findAll("a.internal-link").forEach((link) =>{
			let d = link.getAttr('data-href')
			let filename = (<linktext>parseLinktext(d)).path;
			if(filename in this.allFiles){
				let t = this.allFiles[filename];
				link.setAttrs({"class": `internal-link ${t}`, "style":`color:${this.settings.tagColors[t]}`})
			}
		})
	}

	onunload() {
		this.popoverObserver.disconnect();
		this.observer.disconnect();
		this.editObserver.disconnect();
	}

}

class FileColoringSettings {
	tagSort : {[tag:string] : number} = {};
	tagColors : {[tag:string] : string} = {};
}

class TagSetting extends Setting{
	order: number;
	tag: string;
	color: string;

	constructor(container:HTMLElement, order:number, tag = "", color = "", contentCallback : (o:number,t?:string, c?:string) => any, positionCallback : (old:number, next:number) => any){
		super(container);
		this.order = order;
		this.tag = tag;
		this.color = color;

		this.settingEl.setAttr("style",`order:${this.order}`)
		this.addText(text => text.setPlaceholder('Tag Name')
				.setValue(this.tag)
				.onChange((value) => {
					contentCallback(this.order,value, undefined);
					this.tag = value;
				}))
			.addText(text => text.setPlaceholder("Color")
				.setValue(this.color)
				.onChange((value) => {
					contentCallback(this.order,undefined,value);
					this.color = value;
				}))
			.addExtraButton(button => {
				button.setIcon("left-arrow")
					.onClick(() => {
						console.log(`move from ${this.order} to ${this.order-1}`);
						positionCallback(this.order,this.order-1)
					});
				button.extraSettingsEl.find('svg').setAttr("style","transform:rotate(90deg)");
			})
			.addExtraButton(button => {
				button.setIcon("right-arrow")
					.onClick(() => {
						console.log(`move from ${this.order} to ${this.order+1}`);
						positionCallback(this.order,this.order+1);
					});
				button.extraSettingsEl.find('svg').setAttr("style","transform:rotate(90deg)");
			})
			.addExtraButton(button => {
				button.setIcon("trash")
					.onClick(() => this.settingEl.remove());
				button.extraSettingsEl.setAttr("style","order:unset");
			});
	}

	setPosition(pos: number){
		this.order = pos;
		this.settingEl.setAttr("style", `order:${pos}`)
	}


}


class HighlightSettingsTab extends PluginSettingTab {

	plugin: FileHighlightingPlugin;
	tagList: Array<{"name":string,"color":string,"setting":TagSetting}>;
	tagSettings: Array<Setting>;
	settingsObserver: MutationObserver;

	constructor(app: App, plugin: FileColoringPlugin) {
		super(app, plugin);
		this.plugin = plugin;
		this.tagList = Object.keys(this.plugin.settings.tagSort).sort((a,b) => this.plugin.settings.tagSort[a] - this.plugin.settings.tagSort[b])
		.map((key) => ({"name": key, "color": this.plugin.settings.tagColors[key], "setting": null}))
		// console.log(this.tagList);

		this.settingsObserver = new MutationObserver((mutations) =>{
			let closed = mutations.some((val) => 
				Array.from(val.removedNodes).some((v) =>
					Array.from(v.childNodes).some((c) => (<Element>c).className == "modal mod-settings")
				)
			);
			if(closed){
				console.log("update settings");
				this.updateSettings();
			}
		});
		this.settingsObserver.observe(<Node>document.querySelector(".app-container"), {childList:true});
	}


	display(): void {
		let {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'File Coloring Plugin Settings'});

		let tagSettings = containerEl.createEl('div');
		tagSettings.setAttr('class','tagPluginSettings');

		new Setting(tagSettings)
		.addButton(button => {
			button.setButtonText("Add Another Tag")
				.onClick(() => {
					this.tagList.push({name:"",color:"", setting: new TagSetting(tagSettings,this.tagList.length,"","", (p:number,t:string,c:string) => this.updateTagList(p,t,c), (o:number,n:number) => this.updateTagPosition(o,n))})
				});
		})
		.setName("Specify tags")
		.setDesc('List all tags and associated colors')
		.setClass('controlButton');

		this.tagList.forEach((item, index) => {
			this.tagList[index].setting = new TagSetting(tagSettings,index,item.name,item.color, (p:number,t:string,c:string) => this.updateTagList(p,t,c), (o:number,n:number) => this.updateTagPosition(o,n));
		})

		new Setting(containerEl)
			.setName("Color File Explorer")
			.setDesc("Color codes file explorer based on tags")
			.addToggle(toggle => {
				toggle.onChange((val) => console.log('yes'));
			})
		
		new Setting(containerEl)
			.setName("Color Body Content")
			.setDesc("Color codes body content based on tags")
			.addToggle(toggle => {
				toggle.onChange((val) => console.log('yes'));
			})
	}

	updateTagList(position: number, tag?: string, color?: string){
		if(tag){
			this.tagList[position]["name"]= tag;
		}
		if(color){
			this.tagList[position]["color"] = color;
		}
		// console.log(this.tagList);
	}
	updateTagPosition(oldPosition:number,newPosition:number){
		if(newPosition < this.tagList.length && newPosition >= 0){
			this.tagList.splice(newPosition,0,this.tagList.splice(oldPosition,1)[0]);
			console.log(this.tagList);
			this.tagList.forEach((s, index) => s.setting.setPosition(index));
		}
		
	}

	updateSettings(){
		this.plugin.settings.tagSort = this.tagList.reduce((acc,val,index) => ({...acc, [val.name]:index }), {});
		this.plugin.settings.tagColors = this.tagList.reduce((acc,val) => ({...acc, [val.name]:val.color}),{});
		this.plugin.saveData(this.plugin.settings);
		this.plugin.parseAllFiles();
		this.plugin.resetColors();
	}

	unload(){
		this.settingsObserver.disconnect();
		super.unload();
	}

	close(){
		super.close();
		console.log("Settings Closed");
		this.updateSettings();
	}
}
