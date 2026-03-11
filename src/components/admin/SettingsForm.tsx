'use client';

import { useState, useEffect } from 'react';

interface SettingInfo {
    value: string;
    is_secret: boolean;
    description: string | null;
}

interface FieldConfig {
    key: string;
    label: string;
    type: 'password' | 'text' | 'select' | 'range';
    options?: { value: string; label: string }[];
    min?: number;
    max?: number;
    step?: number;
}

const API_KEY_FIELDS: FieldConfig[] = [
    { key: 'gemini_api_key', label: 'Ключ Gemini API', type: 'password' },
    { key: 'tmdb_api_key', label: 'Ключ TMDB API', type: 'password' },
];

const WATERMARK_FIELDS: FieldConfig[] = [
    {
        key: 'watermark_type', label: 'Тип водяного знака', type: 'select',
        options: [
            { value: 'text', label: 'Текст (celeb.skin)' },
            { value: 'image', label: 'PNG изображение' },
        ],
    },
    { key: 'watermark_image_url', label: 'URL водяного знака (PNG)', type: 'text' },
    {
        key: 'watermark_movement', label: 'Паттерн движения', type: 'select',
        options: [
            { value: 'static', label: 'Статичный' },
            { value: 'rotating_corners', label: 'По углам (4 сек на угол)' },
            { value: 'diagonal_sweep', label: 'Диагональное движение' },
            { value: 'smooth_drift', label: 'Плавный дрифт (синусоида)' },
        ],
    },
    { key: 'watermark_opacity', label: 'Прозрачность', type: 'range', min: 0.1, max: 0.5, step: 0.05 },
    { key: 'watermark_scale', label: 'Масштаб (отн. ширины видео)', type: 'range', min: 0.05, max: 0.2, step: 0.01 },
];

export default function SettingsForm() {
    const [settings, setSettings] = useState<Record<string, SettingInfo>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);
    const [editValues, setEditValues] = useState<Record<string, string>>({});
    const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
    const [feedback, setFeedback] = useState<Record<string, { type: 'success' | 'error'; msg: string }>>({});

    useEffect(() => {
        fetch('/api/admin/settings', { credentials: 'include' })
            .then(r => r.json())
            .then(data => {
                if (data.settings) {
                    setSettings(data.settings);
                }
            })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    async function save(key: string) {
        const value = editValues[key];
        if (value === undefined) return;

        setSaving(key);
        setFeedback(f => ({ ...f, [key]: undefined as unknown as { type: 'success' | 'error'; msg: string } }));

        try {
            const res = await fetch('/api/admin/settings', {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value }),
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                setFeedback(f => ({ ...f, [key]: { type: 'error', msg: data.error || 'Ошибка' } }));
            } else {
                setFeedback(f => ({ ...f, [key]: { type: 'success', msg: 'Сохранено' } }));
                setSettings(s => ({
                    ...s,
                    [key]: { ...s[key], value: data.value },
                }));
                setEditValues(v => { const n = { ...v }; delete n[key]; return n; });
                setTimeout(() => setFeedback(f => { const n = { ...f }; delete n[key]; return n; }), 3000);
            }
        } catch {
            setFeedback(f => ({ ...f, [key]: { type: 'error', msg: 'Ошибка сети' } }));
        } finally {
            setSaving(null);
        }
    }

    function renderField(field: FieldConfig) {
        const info = settings[field.key];
        const currentValue = editValues[field.key] ?? info?.value ?? '';
        const isEdited = editValues[field.key] !== undefined;
        const fb = feedback[field.key];
        const isSaving = saving === field.key;

        return (
            <div key={field.key} className="px-5 py-4 border-b border-gray-800 last:border-0">
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <span className="text-sm text-gray-300">{field.label}</span>
                        {info?.description && (
                            <p className="text-[10px] text-gray-600 mt-0.5">{info.description}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {fb && (
                            <span className={`text-xs ${fb.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                {fb.msg}
                            </span>
                        )}
                        {isEdited && (
                            <button
                                onClick={() => save(field.key)}
                                disabled={isSaving}
                                className="rounded-md bg-[#e50914] px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-wait transition-colors"
                            >
                                {isSaving ? 'Сохранение…' : 'Сохранить'}
                            </button>
                        )}
                    </div>
                </div>

                {field.type === 'password' && (
                    <div className="flex gap-2">
                        <input
                            type={showSecrets[field.key] ? 'text' : 'password'}
                            value={editValues[field.key] ?? ''}
                            onChange={e => setEditValues(v => ({ ...v, [field.key]: e.target.value }))}
                            placeholder={info?.value || 'Не задано'}
                            className="flex-1 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 font-mono placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
                        />
                        <button
                            onClick={() => setShowSecrets(s => ({ ...s, [field.key]: !s[field.key] }))}
                            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-gray-400 hover:text-white transition-colors"
                            title={showSecrets[field.key] ? 'Скрыть' : 'Показать'}
                        >
                            {showSecrets[field.key] ? '🙈' : '👁'}
                        </button>
                    </div>
                )}

                {field.type === 'text' && (
                    <input
                        type="text"
                        value={currentValue}
                        onChange={e => setEditValues(v => ({ ...v, [field.key]: e.target.value }))}
                        placeholder="Не задано"
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 font-mono placeholder:text-gray-600 focus:border-gray-500 focus:outline-none"
                    />
                )}

                {field.type === 'select' && (
                    <select
                        value={currentValue}
                        onChange={e => setEditValues(v => ({ ...v, [field.key]: e.target.value }))}
                        className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none"
                    >
                        {field.options?.map(o => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                )}

                {field.type === 'range' && (
                    <div className="flex items-center gap-3">
                        <input
                            type="range"
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            value={currentValue}
                            onChange={e => setEditValues(v => ({ ...v, [field.key]: e.target.value }))}
                            className="flex-1 accent-[#e50914]"
                        />
                        <span className="text-sm font-mono text-gray-300 w-12 text-right">{currentValue}</span>
                    </div>
                )}
            </div>
        );
    }

    if (loading) {
        return (
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-8 text-center text-gray-500">
                Загрузка настроек…
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* API Keys */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800">
                    <h2 className="text-sm font-semibold text-white">API ключи</h2>
                    <p className="text-[10px] text-gray-600 mt-0.5">Сохраняются в БД. Приоритет над .env.local. Кэш 60 сек.</p>
                </div>
                {API_KEY_FIELDS.map(renderField)}
            </div>

            {/* Watermark */}
            <div className="rounded-xl border border-gray-800 bg-gray-900/50 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-800">
                    <h2 className="text-sm font-semibold text-white">Водяной знак</h2>
                    <p className="text-[10px] text-gray-600 mt-0.5">Настройки для pipeline водяного знака на Contabo</p>
                </div>
                {WATERMARK_FIELDS.map(renderField)}

                {/* Watermark PNG upload */}
                <div className="px-5 py-4 border-t border-gray-800">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-gray-600 mb-2">Загрузить PNG водяного знака</p>
                    <div className="flex items-center gap-3">
                        <input
                            type="file"
                            accept="image/png,image/webp"
                            onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setSaving('watermark_upload');
                                try {
                                    const fd = new FormData();
                                    fd.append('file', file);
                                    const res = await fetch('/api/admin/watermark/upload', {
                                        method: 'POST',
                                        credentials: 'include',
                                        body: fd,
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                        setFeedback(f => ({ ...f, watermark_upload: { type: 'success', msg: 'Загружен' } }));
                                        setSettings(s => ({
                                            ...s,
                                            watermark_image_url: { ...s.watermark_image_url, value: data.url },
                                            watermark_type: { ...s.watermark_type, value: 'image' },
                                        }));
                                        setTimeout(() => setFeedback(f => { const n = { ...f }; delete n.watermark_upload; return n; }), 3000);
                                    } else {
                                        setFeedback(f => ({ ...f, watermark_upload: { type: 'error', msg: data.error || 'Ошибка' } }));
                                    }
                                } catch {
                                    setFeedback(f => ({ ...f, watermark_upload: { type: 'error', msg: 'Ошибка сети' } }));
                                } finally {
                                    setSaving(null);
                                }
                            }}
                            className="text-xs text-gray-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600 file:cursor-pointer"
                        />
                        {saving === 'watermark_upload' && <span className="text-xs text-gray-500">Загрузка...</span>}
                        {feedback.watermark_upload && (
                            <span className={`text-xs ${feedback.watermark_upload.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                                {feedback.watermark_upload.msg}
                            </span>
                        )}
                    </div>
                </div>

                {/* Watermark preview */}
                {settings.watermark_image_url?.value && (
                    <div className="px-5 py-4 border-t border-gray-800">
                        <p className="text-[10px] font-medium uppercase tracking-wider text-gray-600 mb-2">Текущий водяной знак</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={settings.watermark_image_url.value}
                            alt="Watermark"
                            className="max-h-16 rounded border border-gray-700 bg-gray-800 p-1"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
