import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { ArrowUp, ArrowDown, Search, Upload, BrainCircuit, FileText, Loader2, Music, X, History, Info } from 'lucide-react';

// 主應用程式組件
const App = () => {
    // State 管理
    const [youtubeHistory, setYoutubeHistory] = useState([]);
    const [processedMusic, setProcessedMusic] = useState([]);
    const [filteredData, setFilteredData] = useState([]);
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingProgress, setProcessingProgress] = useState(0); 
    
    const [searchTerm, setSearchTerm] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: null, direction: 'ascending' });
    
    const [recap, setRecap] = useState('');
    const [isRecapLoading, setIsRecapLoading] = useState(false);

    const fileInputRef = useRef(null);

    // 當 processedMusic 更新時，同時更新 filteredData
    useEffect(() => {
        setFilteredData(processedMusic);
    }, [processedMusic]);

    // 檔案處理：現在處理 JSON 檔案
    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file && file.name.includes('watch-history.json')) {
            setIsLoading(true);
            setError('');
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const historyData = JSON.parse(e.target.result);
                    const history = historyData.map(item => {
                        const title = item.title?.replace(/^Watched /, '');
                        const channel = item.subtitles?.[0]?.name;
                        const date = item.time ? new Date(item.time).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }) : 'N/A';
                        
                        if (title && channel) {
                            return { title, channel, date };
                        }
                        return null;
                    }).filter(item => item !== null);

                    setYoutubeHistory(history);
                    setError('');
                } catch (err) {
                    setError('解析JSON檔案時出錯，請確保檔案格式正確。');
                    console.error("Parsing error:", err);
                } finally {
                    setIsLoading(false);
                }
            };
            reader.onerror = () => {
                setError('讀取檔案失敗。');
                setIsLoading(false);
            };
            reader.readAsText(file);
        } else {
            setError('請上傳有效的 watch-history.json 檔案。');
        }
        event.target.value = null;
    };

    // 使用 Gemini API 處理歷史記錄
    const processHistoryWithGemini = async () => {
        if (youtubeHistory.length === 0) {
            setError('沒有可供處理的觀看記錄。');
            return;
        }
        setIsProcessing(true);
        setProcessingProgress(0);
        setProcessedMusic([]);
        setRecap('');
        setError(''); // 清除舊的錯誤訊息

        try {
            const chunks = [];
            const CHUNK_SIZE = 1500; 
            for (let i = 0; i < youtubeHistory.length; i += CHUNK_SIZE) {
                chunks.push(youtubeHistory.slice(i, i + CHUNK_SIZE));
            }

            let allProcessed = [];
            let processedCount = 0;

            for (const chunk of chunks) {
                const prompt = `
                    You are a music analysis expert. Your task is to process a list of YouTube viewing history items and identify which ones are music tracks.
                    For each item, analyze the 'title' and 'channel'.
                    - If it is a song, extract the exact song name and artist.
                    - If it's a cover song, identify it as such, list the cover artist, and find the original artist.
                    - If it's not a song (e.g., a vlog, tech review, podcast, clip), ignore it completely.
                    - The output must be a perfectly valid and complete JSON array of objects.
                    - CRITICAL: Ensure all string values within the JSON are properly escaped. Newlines must be escaped as \\n, and double quotes must be escaped as \\". Failure to escape these characters will result in an invalid JSON string. For example, a title like "My "Cool" Song" must be represented as "songName": "My \\"Cool\\" Song".

                    Here is the data chunk:
                    ${JSON.stringify(chunk.map(h => ({ title: h.title, channel: h.channel })))}
                `;
                
                const payload = {
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseMimeType: "application/json",
                        responseSchema: {
                            type: "ARRAY",
                            items: {
                                type: "OBJECT",
                                properties: {
                                    songName: { type: "STRING", description: "The name of the song." },
                                    artist: { type: "STRING", description: "The artist of the song." },
                                    isCover: { type: "BOOLEAN", description: "True if this is a cover song." },
                                    originalArtist: { type: "STRING", description: "The original artist if it's a cover. Can be null." }
                                },
                                required: ["songName", "artist", "isCover"]
                            }
                        }
                    }
                };
                
                const apiKey = "AIzaSyDc6GigsTq9-XMnmeNiih9cYWbSFGRxyXw"; 
                const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
                
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`API 請求失敗，狀態碼：${response.status}。回應：${errorBody}`);
                }
                
                const result = await response.json();
                
                // **增強**：更強韌的解析與錯誤處理機制
                if (result.candidates && result.candidates.length > 0 &&
                    result.candidates[0].content && result.candidates[0].content.parts &&
                    result.candidates[0].content.parts.length > 0) {
                    
                    let text = result.candidates[0].content.parts[0].text;
                    
                    try {
                        // 優先嘗試直接解析
                        const parsedJson = JSON.parse(text);
                        allProcessed.push(...parsedJson);
                    } catch (e) {
                        // 如果直接解析失敗，則啟用修復機制
                        console.warn("常規JSON解析失敗，嘗試修復...", { error: e.message });
                        console.error("來自API的問題原始文本:", text);
                        
                        const objects = [];
                        let braceCount = 0;
                        let objectStart = -1;
                        let inString = false;

                        for (let i = 0; i < text.length; i++) {
                            const char = text[i];
                            
                            if (char === '"' && (i === 0 || text[i-1] !== '\\')) {
                                inString = !inString;
                            }

                            if (!inString) {
                                if (char === '{') {
                                    if (braceCount === 0) {
                                        objectStart = i;
                                    }
                                    braceCount++;
                                } else if (char === '}') {
                                    braceCount--;
                                    if (braceCount === 0 && objectStart !== -1) {
                                        const objectStr = text.substring(objectStart, i + 1);
                                        try {
                                            const parsed = JSON.parse(objectStr);
                                            objects.push(parsed);
                                        } catch (objError) {
                                            console.warn("發現一個無法解析的損壞物件，已跳過:", objectStr);
                                        }
                                        objectStart = -1;
                                    }
                                }
                            }
                        }
                        
                        if (objects.length > 0) {
                            console.log(`成功從損壞的資料中修復並解析了 ${objects.length} 個物件。`);
                            allProcessed.push(...objects);
                            setError(prev => prev.includes("自動修復") ? prev : (prev ? prev + " " : "") + "部分資料格式有誤，已嘗試自動修復。");
                        } else {
                            console.error("無法從損壞的批次中修復任何資料。");
                            setError("部分資料分析時發生嚴重格式問題且無法自動修復，結果可能不完整。請檢查主控台。");
                        }
                    }
                } else {
                     console.warn("API 回應中未找到有效內容，已跳過此批次。", result);
                }

                processedCount++;
                const newProgress = Math.round((processedCount / chunks.length) * 100);
                setProcessingProgress(newProgress);
            }
            
            setProcessedMusic(allProcessed);

        } catch (err) {
            setError(`處理過程中發生嚴重錯誤: ${err.message}`); 
            console.error("Gemini processing error:", err);
        } finally {
            setIsProcessing(false);
        }
    };
    
    // 生成回顧
    const generateRecap = async () => {
        if (processedMusic.length === 0) {
            setError('沒有音樂資料可供生成回顧。');
            return;
        }
        setIsRecapLoading(true);
        setRecap('');
        setError('');
        try {
            const prompt = `
                Based on the following list of songs I've listened to, provide a concise and engaging summary of my listening habits.
                Analyze the data to identify my top artists, top songs, and potential favorite genres.
                The summary should be written in Traditional Chinese, be friendly, and highlight 2-3 key insights.
                Keep it under 200 words.

                My listening data:
                ${JSON.stringify(processedMusic)}
            `;
            
            let chatHistory = [];
            chatHistory.push({ role: "user", parts: [{ text: prompt }] });
            const payload = { contents: chatHistory };
            const apiKey = "AIzaSyDc6GigsTq9-XMnmeNiih9cYWbSFGRxyXw";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`API 請求失敗，狀態碼：${response.status}。回應：${errorBody}`);
            }
            const result = await response.json();
            if (result.candidates && result.candidates.length > 0) {
                const text = result.candidates[0].content.parts[0].text;
                setRecap(text);
            } else {
                setError('無法從 Gemini 獲得回顧。');
            }
        } catch (err) {
            setError(`生成回顧時出錯: ${err.message}`);
            console.error(err);
        } finally {
            setIsRecapLoading(false);
        }
    };

    // 搜尋過濾
    useEffect(() => {
        const lowercasedTerm = searchTerm.toLowerCase();
        const results = processedMusic.filter(item =>
            item.songName?.toLowerCase().includes(lowercasedTerm) ||
            item.artist?.toLowerCase().includes(lowercasedTerm) ||
            item.originalArtist?.toLowerCase().includes(lowercasedTerm)
        );
        setFilteredData(results);
    }, [searchTerm, processedMusic]);

    // 排序邏輯
    const sortedData = useMemo(() => {
        let sortableItems = [...filteredData];
        if (sortConfig.key !== null) {
            sortableItems.sort((a, b) => {
                const valA = a[sortConfig.key] || '';
                const valB = b[sortConfig.key] || '';
                if (valA < valB) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (valA > valB) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [filteredData, sortConfig]);
    
    const requestSort = (key) => {
        let direction = 'ascending';
        if (sortConfig.key === key && sortConfig.direction === 'ascending') {
            direction = 'descending';
        }
        setSortConfig({ key, direction });
    };

    const getSortIcon = (key) => {
        if (sortConfig.key !== key) {
            return null;
        }
        return sortConfig.direction === 'ascending' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />;
    };

    // 數據統計
    const stats = useMemo(() => {
        const totalSongs = processedMusic.length;
        const uniqueArtists = new Set(processedMusic.map(item => item.artist)).size;
        const uniqueSongs = new Set(processedMusic.map(item => `${item.songName} - ${item.artist}`)).size;
        const coverSongs = processedMusic.filter(item => item.isCover).length;
        return { totalSongs, uniqueArtists, uniqueSongs, coverSongs };
    }, [processedMusic]);


    // 渲染組件
    return (
        <div className="bg-gray-900 text-white min-h-screen font-sans flex flex-col p-4 md:p-8">
            <header className="flex flex-col sm:flex-row justify-between items-center mb-6 pb-4 border-b border-gray-700">
                <div className="flex items-center mb-4 sm:mb-0">
                    <History className="w-8 h-8 text-red-500 mr-3" />
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight">YouTube 收聽記錄分析器</h1>
                </div>
                <div className="flex items-center space-x-2">
                    <button
                        onClick={() => fileInputRef.current.click()}
                        className="flex items-center bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 disabled:bg-gray-500"
                        disabled={isLoading || isProcessing}
                    >
                        <Upload className="w-5 h-5 mr-2" />
                        {isLoading ? '讀取中...' : '上傳 watch-history.json'}
                    </button>
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        className="hidden"
                        accept=".json"
                    />
                </div>
            </header>

            {error && <div className="bg-yellow-800 border border-yellow-600 text-yellow-100 px-4 py-3 rounded-lg relative mb-4" role="alert">
                <strong className="font-bold">注意：</strong>
                <span className="block sm:inline ml-2">{error}</span>
                 <button onClick={() => setError('')} className="absolute top-0 bottom-0 right-0 px-4 py-3">
                    <X className="w-5 h-5" />
                </button>
            </div>}

            {youtubeHistory.length > 0 && processedMusic.length === 0 && !isProcessing && (
                 <div className="bg-gray-800 p-6 rounded-lg mb-6 flex flex-col items-center text-center">
                    <FileText className="w-12 h-12 text-red-400 mb-4" />
                    <h2 className="text-xl font-semibold mb-2">已成功讀取 <span className="text-red-400">{youtubeHistory.length}</span> 筆觀看記錄！</h2>
                    <p className="text-gray-400 mb-4 max-w-2xl">現在，點擊下方的按鈕，讓 Gemini 為您分析這些記錄，篩選出所有音樂，並將它們整理成清晰的列表。這個過程可能需要一些時間，請耐心等候。</p>
                    <button
                        onClick={processHistoryWithGemini}
                        disabled={isProcessing}
                        className="flex items-center justify-center bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg transition-colors duration-200 disabled:bg-gray-500 disabled:cursor-not-allowed w-full sm:w-auto"
                    >
                        {isProcessing ? (
                            <>
                                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                                分析中...
                            </>
                        ) : (
                            <>
                                <BrainCircuit className="w-5 h-5 mr-2" />
                                開始 Gemini 智慧分析
                            </>
                        )}
                    </button>
                </div>
            )}
            
            {isProcessing && (
                <div className="flex flex-col items-center justify-center bg-gray-800 p-6 rounded-lg mb-6">
                    <Loader2 className="w-12 h-12 text-red-500 animate-spin mb-4" />
                    <p className="text-lg mb-2">Gemini 正在努力為您分析資料...</p>
                    <p className="text-gray-400 mb-4">這可能需要幾分鐘，請不要關閉此頁面。</p>
                    <div className="w-full bg-gray-700 rounded-full h-4">
                        <div
                            className="bg-green-500 h-4 rounded-full transition-all duration-500"
                            style={{ width: `${processingProgress}%` }}
                        ></div>
                    </div>
                    <p className="mt-2 text-lg font-semibold">{processingProgress}%</p>
                </div>
            )}


            {processedMusic.length > 0 ? (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                        <StatCard title="總收聽歌曲" value={stats.totalSongs} icon={<Music className="w-6 h-6" />} />
                        <StatCard title="獨立歌曲數" value={stats.uniqueSongs} icon={<Music className="w-6 h-6" />} />
                        <StatCard title="獨立歌手數" value={stats.uniqueArtists} icon={<Music className="w-6 h-6" />} />
                        <StatCard title="Cover 歌曲數" value={stats.coverSongs} icon={<Music className="w-6 h-6" />} />
                    </div>

                     {/* 回顧區塊 */}
                    <div className="bg-gray-800 p-6 rounded-lg mb-6">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold text-red-400">收聽習慣回顧</h2>
                            <button
                                onClick={generateRecap}
                                disabled={isRecapLoading}
                                className="flex items-center bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg transition-colors duration-200 disabled:bg-gray-500"
                            >
                                {isRecapLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : '重新生成'}
                            </button>
                        </div>
                        {isRecapLoading && <p className="text-center">正在生成回顧...</p>}
                        {recap ? <p className="text-gray-300 whitespace-pre-wrap">{recap}</p> : <p className="text-gray-500">點擊按鈕生成您的收聽習慣分析。</p>}
                    </div>

                    <div className="bg-gray-800 p-4 sm:p-6 rounded-lg">
                        <div className="flex flex-col sm:flex-row justify-between items-center mb-4">
                            <h2 className="text-xl font-semibold mb-2 sm:mb-0">歌曲列表</h2>
                            <div className="relative w-full sm:w-64">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                <input
                                    type="text"
                                    placeholder="搜尋歌曲或歌手..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full bg-gray-700 border border-gray-600 rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-red-500"
                                />
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-600">
                                    <tr>
                                        <th className="p-3 cursor-pointer" onClick={() => requestSort('songName')}>
                                            <div className="flex items-center">歌曲名稱 {getSortIcon('songName')}</div>
                                        </th>
                                        <th className="p-3 cursor-pointer" onClick={() => requestSort('artist')}>
                                            <div className="flex items-center">歌手 {getSortIcon('artist')}</div>
                                        </th>
                                        <th className="p-3">備註</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedData.map((item, index) => (
                                        <tr key={index} className="border-b border-gray-700 hover:bg-gray-700/50">
                                            <td className="p-3">{item.songName}{item.isCover && <span className="text-yellow-400 ml-2 text-xs font-bold">(Cover)</span>}</td>
                                            <td className="p-3">{item.artist}</td>
                                            <td className="p-3 text-gray-400">{item.isCover && `原唱: ${item.originalArtist || '未知'}`}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                             {sortedData.length === 0 && <p className="text-center py-8 text-gray-500">找不到符合條件的歌曲。</p>}
                        </div>
                    </div>
                </>
            ) : (
                 !isLoading && !isProcessing && (
                     <div className="flex-grow flex items-center justify-center">
                        <div className="text-center text-gray-500">
                            <Info className="w-16 h-16 mx-auto mb-4" />
                            <h2 className="text-2xl mb-2">準備開始分析</h2>
                            <p className="max-w-md">請點擊右上角的「上傳」按鈕，選擇您從 Google Takeout 下載的 `watch-history.json` 檔案，開始您的音樂旅程分析。</p>
                        </div>
                    </div>
                 )
            )}
        </div>
    );
};


// StatCard 組件
const StatCard = ({ title, value, icon }) => (
    <div className="bg-gray-800 p-4 rounded-lg flex items-center">
        <div className="p-3 rounded-full bg-red-500/20 text-red-400 mr-4">
            {icon}
        </div>
        <div>
            <p className="text-sm text-gray-400">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
        </div>
    </div>
);


export default App;
